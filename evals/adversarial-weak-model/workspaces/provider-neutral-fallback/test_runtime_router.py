from runtime_router import select_model

assert (
    select_model({"FORGEWRIGHT_MODEL": "runtime-a", "NINEROUTER_MODEL": "legacy-b"})
    == "runtime-a"
)
assert select_model({"NINEROUTER_MODEL": "legacy-b"}) == "legacy-b"
assert select_model({}) == ""
print("verified")
