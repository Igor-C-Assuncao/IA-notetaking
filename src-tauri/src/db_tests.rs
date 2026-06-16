use super::*;
use rusqlite::Connection;

#[test]
fn test_database_migrations_are_idempotent() {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory database");

    // First initialization
    let res1 = initialize_db_schema(&conn);
    assert!(
        res1.is_ok(),
        "First DB schema initialization failed: {:?}",
        res1.err()
    );

    // Second initialization (should handle migrations and table creations gracefully without error)
    let res2 = initialize_db_schema(&conn);
    assert!(
        res2.is_ok(),
        "Second (idempotent) DB schema initialization failed: {:?}",
        res2.err()
    );
}

#[test]
fn test_save_meeting_and_get_meetings_ordering() {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory database");
    initialize_db_schema(&conn).expect("Failed to setup schema");

    // Insert first meeting
    conn.execute(
        "INSERT INTO meetings (date, title, raw_transcript, markdown_summary, speakers, tags, structured_summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            "2026-05-23 10:00:00",
            "First Meeting",
            "Alice: We are launching today.",
            "## Summary 1",
            "[\"Alice\"]",
            "[\"launch\"]",
            "{\"tldr\": \"launching\"}"
        ],
    ).expect("Failed to insert first meeting");

    // Insert second meeting (later id)
    conn.execute(
        "INSERT INTO meetings (date, title, raw_transcript, markdown_summary, speakers, tags, structured_summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            "2026-05-24 12:00:00",
            "Second Meeting",
            "Bob: Hello Carlos.",
            "## Summary 2",
            "[\"Bob\"]",
            "[\"carlos\"]",
            "{\"tldr\": \"carlos\"}"
        ],
    ).expect("Failed to insert second meeting");

    // Query meetings - should return in DESC order of ID (newest first)
    let mut stmt = conn
        .prepare(
            "SELECT id, date, title, raw_transcript, markdown_summary, speakers, tags,
                structured_summary, transcript_segments, schema_version
         FROM meetings ORDER BY id DESC",
        )
        .expect("Failed to prepare get statement");

    let iter = stmt
        .query_map([], |row| {
            Ok(Meeting {
                id: Some(row.get(0)?),
                date: row.get(1)?,
                title: row.get(2)?,
                raw_transcript: row.get(3)?,
                markdown_summary: row.get(4)?,
                speakers: row.get(5)?,
                tags: row.get(6)?,
                structured_summary: row.get(7)?,
                transcript_segments: row.get(8)?,
                schema_version: row.get(9)?,
            })
        })
        .expect("Failed to query map");

    let meetings: Vec<Meeting> = iter.map(|m| m.unwrap()).collect();

    assert_eq!(meetings.len(), 2);
    // Check descending order (ID 2 should be first, ID 1 second)
    assert_eq!(meetings[0].title, "Second Meeting");
    assert_eq!(meetings[1].title, "First Meeting");
    assert_eq!(meetings[0].schema_version, 1);
    assert!(meetings[0].transcript_segments.is_none());
}

#[test]
fn test_fts5_full_text_search_matching() {
    let conn = Connection::open_in_memory().expect("Failed to open in-memory database");
    initialize_db_schema(&conn).expect("Failed to setup schema");

    // Insert dummy meetings to trigger FTS5 indexes
    conn.execute(
        "INSERT INTO meetings (date, title, raw_transcript, markdown_summary, speakers, tags, structured_summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            "2026-05-24 10:00:00",
            "Database Launch Rehearsal",
            "Alice: Let's do a run through of our postgres deployment metrics.",
            "## Rehearsal Notes",
            "[\"Alice\"]",
            "[\"database\"]",
            "{}"
        ],
    ).expect("Failed to insert meeting 1");

    conn.execute(
        "INSERT INTO meetings (date, title, raw_transcript, markdown_summary, speakers, tags, structured_summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            "2026-05-24 11:00:00",
            "Marketing Sync",
            "Bob: We need to publish some ads.",
            "## Ads outline",
            "[\"Bob\"]",
            "[\"marketing\"]",
            "{}"
        ],
    ).expect("Failed to insert meeting 2");

    // Query FTS5 for "postgres"
    let fts_query = "postgres*";
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.date, m.title, m.raw_transcript, m.markdown_summary
         FROM meetings m
         JOIN meetings_fts fts ON fts.rowid = m.id
         WHERE meetings_fts MATCH ?1
         ORDER BY m.id DESC",
        )
        .expect("Failed to prepare search statement");

    let iter = stmt
        .query_map(rusqlite::params![fts_query], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(2)?))
        })
        .expect("Failed to query map FTS5");

    let results: Vec<(i32, String)> = iter.map(|r| r.unwrap()).collect();

    // Should match "Database Launch Rehearsal" because it has "postgres" in raw_transcript
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].1, "Database Launch Rehearsal");

    // Query FTS5 for "Sync" in title
    let fts_query_sync = "Sync*";
    let mut stmt_sync = conn
        .prepare(
            "SELECT m.id, m.date, m.title, m.raw_transcript, m.markdown_summary
         FROM meetings m
         JOIN meetings_fts fts ON fts.rowid = m.id
         WHERE meetings_fts MATCH ?1",
        )
        .expect("Failed to prepare search statement sync");

    let iter_sync = stmt_sync
        .query_map(rusqlite::params![fts_query_sync], |row| {
            Ok((row.get::<_, i32>(0)?, row.get::<_, String>(2)?))
        })
        .expect("Failed to query map sync");

    let results_sync: Vec<(i32, String)> = iter_sync.map(|r| r.unwrap()).collect();
    assert_eq!(results_sync.len(), 1);
    assert_eq!(results_sync[0].1, "Marketing Sync");
}
