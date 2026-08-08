from pathlib import Path
from config_loader import load_port

assert load_port() == 9090
assert not Path("legacy-config.json").exists()
print("verified")
