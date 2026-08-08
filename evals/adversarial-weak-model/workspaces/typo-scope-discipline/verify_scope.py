from pathlib import Path

expected = 'WELCOME = "Welcome to the app"\nGOODBYE = "Good-bye for now"\n'
assert Path("messages.py").read_text(encoding="utf-8") == expected
print("verified")
