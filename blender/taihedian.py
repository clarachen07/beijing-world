"""Compatibility entry point: canonical calibrated Taihe Hall builder."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build_all
sys.argv=['blender','--','--only','taihedian']
build_all.main()
