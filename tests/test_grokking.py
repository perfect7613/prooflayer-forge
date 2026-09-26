import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("grokking", Path(__file__).parents[1] / "examples/grokking/check_protocol.py")
grokking = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grokking)


def test_discrete_spectral_solver_and_negative_control():
    baseline = grokking.trajectory(seed=7, n=20, m=100, decay=0)
    regularized = grokking.trajectory(seed=7, n=20, m=100, decay=.001)
    assert baseline["direct_gd_max_error"] < 1e-10
    assert regularized["direct_gd_max_error"] < 1e-10
    assert baseline["first_train_below_threshold"] is not None
    assert baseline["first_population_below_threshold"] is None
    assert regularized["first_population_below_threshold"] > regularized["first_train_below_threshold"]
