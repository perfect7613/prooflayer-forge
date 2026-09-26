"""Developer feasibility check. This is NOT an agent-generated reproduction.

Source specification: https://arxiv.org/html/2601.19791v1, Eq. 2 and Sec. 5.1.
Uses exact discrete GD evolution to avoid tens of thousands of dense updates.
The implementation is checked against direct updates before extrapolation.
"""
import json
import numpy as np


def trajectory(seed=0, n=100, m=1000, decay=1e-4, eta=1.0, variance=1.0):
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(n, m)) / np.sqrt(m)
    teacher = rng.normal(size=m)
    teacher /= np.linalg.norm(teacher)
    initial = rng.normal(size=m) * np.sqrt(variance)
    _, s, vt = np.linalg.svd(x, full_matrices=False)
    eigenvalues = s**2 / n
    target = vt @ teacher
    initial_row = vt @ initial
    fixed = eigenvalues * target / (eigenvalues + decay)
    null_initial = initial - vt.T @ initial_row
    null_teacher = teacher - vt.T @ target

    def weights(t):
        row = fixed + (1 - eta * (eigenvalues + decay))**t * (initial_row - fixed)
        return vt.T @ row + (1 - eta * decay)**t * null_initial

    direct = initial.copy()
    for _ in range(100):
        direct -= eta * (x.T @ (x @ (direct - teacher)) / n + decay * direct)
    direct_error = float(np.max(np.abs(weights(100) - direct)))
    assert direct_error < 1e-10, direct_error

    def losses(t):
        row_error = fixed + (1 - eta * (eigenvalues + decay))**t * (initial_row - fixed) - target
        null_error = (1 - eta * decay)**t * null_initial - null_teacher
        # Half-MSE training objective; population loss is ordinary MSE in the paper.
        train = float(np.sum(s**2 * row_error**2) / (2 * n))
        population = float((row_error @ row_error + null_error @ null_error) / m)
        return train, population

    def first_below(index, horizon=200000):
        # Scan the entire horizon in chunks: no unverified monotonicity assumption.
        for start in range(0, horizon + 1, 1000):
            t = np.arange(start, min(start + 1000, horizon + 1))[:, None]
            row_error = fixed + (1 - eta * (eigenvalues + decay))**t * (initial_row - fixed) - target
            if index == 0:
                values = np.sum(s**2 * row_error**2, axis=1) / (2 * n)
            else:
                scale = (1 - eta * decay)**t[:, 0]
                null_norm = scale**2 * (null_initial @ null_initial) - 2 * scale * (null_initial @ null_teacher) + null_teacher @ null_teacher
                values = (np.sum(row_error**2, axis=1) + null_norm) / m
            hits = np.flatnonzero(values < .01)
            if len(hits):
                return start + int(hits[0])
        return None

    t1, t2 = first_below(0), first_below(1)
    times = np.unique(np.r_[0, np.geomspace(1, 200000, 70).astype(int)])
    return {"seed": seed, "n": n, "m": m, "lambda": decay, "eta": eta,
            "initialization_variance": variance, "threshold": .01,
            "train_loss_convention": "half MSE", "population_loss_convention": "MSE",
            "first_train_below_threshold": t1, "first_population_below_threshold": t2,
            "direct_gd_max_error": direct_error,
            "population_at_train_crossing": losses(t1)[1] if t1 is not None else None,
            "final_population": losses(200000)[1],
            "curve": [{"step": int(t), "train": losses(t)[0], "population": losses(t)[1]} for t in times]}


if __name__ == "__main__":
    runs = [trajectory(seed=seed, decay=decay) for seed in range(3) for decay in (0.0, 1e-4, 2e-4)]
    print(json.dumps({"provenance": "developer feasibility check, not a TrueForge run", "scope": "paper_subset",
                      "excluded": ["neural-network experiments", "theorem proofs", "complete Figure 2 sweeps"], "runs": runs}, indent=2))
