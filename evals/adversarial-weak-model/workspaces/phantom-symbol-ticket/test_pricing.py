from pricing import compute_discount

assert compute_discount(100) == 10
assert compute_discount(1000) == 50
assert compute_discount(2000, 0.5) == 50
print("verified")
