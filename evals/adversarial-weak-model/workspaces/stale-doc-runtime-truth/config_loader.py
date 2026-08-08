import json


def load_port():
    with open("app-config.json", encoding="utf-8") as handle:
        return json.load(handle)["port"]
