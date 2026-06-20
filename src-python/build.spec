# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

block_cipher = None

# Collect dependencies' data files
datas = []
try:
    datas += collect_data_files('whisperx')
except Exception:
    pass

try:
    datas += collect_data_files('silero_vad')
except Exception:
    pass

try:
    datas += collect_data_files('pyannote.audio')
except Exception:
    pass

try:
    datas += copy_metadata('torchcodec')
except Exception:
    pass

# Bundle local models cache folder if present
models_dir = os.path.abspath(os.path.join(os.getcwd(), 'models'))
if os.path.exists(models_dir):
    datas.append((models_dir, 'models'))

# Collect submodules that might be dynamically imported by LangChain / LangGraph
hiddenimports = []
hiddenimports += collect_submodules('whisperx')
hiddenimports += collect_submodules('transformers.pipelines')
hiddenimports += collect_submodules('pyannote.audio')
hiddenimports += collect_submodules('langgraph')
hiddenimports += collect_submodules('langchain_core')
hiddenimports += collect_submodules('langchain_community')
hiddenimports += collect_submodules('langchain_google_genai')
hiddenimports += collect_submodules('langchain_openai')
hiddenimports += collect_submodules('langchain_anthropic')
hiddenimports += [
    'pyaudiowpatch',
    'soundcard',
    'numpy',
    'torch',
    'torchaudio',
    'soxr',
    'librosa',
    'soundfile',
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='ai-notetaking-engine',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
