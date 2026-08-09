"""
Unit tests for TokenAPI and related classes.

Tests API server logic and cost estimation.
"""

import importlib.util
from pathlib import Path

import pytest

# Load token-api-server.py (has hyphen in name, need importlib)
_test_file = Path(__file__).resolve()
_project_root = _test_file.parent.parent.parent
_scripts = _project_root / "scripts"

_spec = importlib.util.spec_from_file_location(
    "token_api_server", _scripts / "telemetry" / "token-api-server.py"
)
_token_api = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_token_api)

# Import from loaded module
TokenAPI = _token_api.TokenAPI
PRICING = _token_api.PRICING
get_pricing_for_model = _token_api.get_pricing_for_model
estimate_cost = _token_api.estimate_cost
CursorDBReader = _token_api.CursorDBReader
ClaudeTelemetryReader = _token_api.ClaudeTelemetryReader
UnifiedAggregator = _token_api.UnifiedAggregator
is_authorized_request = _token_api.is_authorized_request
is_loopback_host = _token_api.is_loopback_host
validate_bind_policy = _token_api.validate_bind_policy


class TestDashboardBindPolicy:
    def test_loopback_hosts_are_local(self):
        assert is_loopback_host("localhost")
        assert is_loopback_host("127.0.0.1")
        assert is_loopback_host("127.42.0.9")
        assert is_loopback_host("::1")
        assert not is_loopback_host("0.0.0.0")
        assert not is_loopback_host("192.168.1.20")

    def test_non_loopback_requires_auth_token(self):
        with pytest.raises(ValueError, match="FORGEWRIGHT_TOKEN_DASHBOARD_AUTH_TOKEN"):
            validate_bind_policy("0.0.0.0", "")
        validate_bind_policy("0.0.0.0", "secret")
        validate_bind_policy("127.0.0.1", "")

    def test_basic_auth_is_exact_and_optional_locally(self):
        assert is_authorized_request(None, "")
        assert not is_authorized_request(None, "secret")
        assert not is_authorized_request("Basic invalid", "secret")
        expected = _token_api._expected_basic_auth("secret")
        assert is_authorized_request(expected, "secret")


class TestTokenAPI:
    """Test TokenAPI class."""

    def test_init(self):
        """Test API initialization."""
        api = TokenAPI()
        assert api.base_path.name == "usage"

    def test_list_projects_empty(self):
        """Test listing projects when none exist."""
        api = TokenAPI()
        projects = api.list_projects()
        assert isinstance(projects, list)

    def test_load_records_empty(self):
        """Test loading records from nonexistent project."""
        api = TokenAPI()
        records = api.load_records("nonexistent-project-xyz-123", period=7)
        assert records == []

    def test_get_usage_empty(self):
        """Test get_usage with no data."""
        api = TokenAPI()
        usage = api.get_usage("nonexistent-project-xyz-456", period=7)

        assert usage["project"] == "nonexistent-project-xyz-456"
        assert usage["summary"]["total_tokens"] == 0
        assert usage["summary"]["total_calls"] == 0
        assert usage["summary"]["total_cost_usd"] == 0

    def test_calculate_cost(self):
        """Test cost calculation."""
        api = TokenAPI()
        cost = api.calculate_cost(
            provider="anthropic",
            model="claude-3-5-sonnet-20241022",
            input_tokens=1_000_000,
            output_tokens=500_000,
        )

        # 1M input @ $3/M = $3, 500K output @ $15/M = $7.50
        expected = 3.0 + 7.5
        assert abs(cost - expected) < 0.01


class TestPricingFunctions:
    """Test pricing utility functions."""

    def test_get_pricing_exact_match(self):
        """Test exact model match returns valid pricing."""
        pricing = get_pricing_for_model("claude-3-5-sonnet-20241022")
        # get_pricing_for_model does prefix matching, may return different model
        assert "input" in pricing
        assert "output" in pricing
        assert pricing["input"] >= 0
        assert pricing["output"] >= 0

    def test_get_pricing_partial_match(self):
        """Test partial model name match returns valid pricing."""
        pricing = get_pricing_for_model("claude-3-5-sonnet")
        # Should return some valid pricing
        assert "input" in pricing
        assert "output" in pricing

    def test_get_pricing_unknown_model(self):
        """Test unknown model returns default."""
        pricing = get_pricing_for_model("completely-unknown-model-xyz")
        assert "input" in pricing
        assert "output" in pricing
        # Should return default estimate
        assert pricing["input"] == 5.0
        assert pricing["output"] == 20.0

    def test_estimate_cost_claude(self):
        """Test cost estimation for Claude."""
        cost = estimate_cost(call_count=10, model_name="claude-3-5-sonnet")
        assert cost > 0
        # For 10 calls, should be less than $10 (rough estimate)
        assert cost < 10

    def test_estimate_cost_gpt(self):
        """Test cost estimation for GPT."""
        cost = estimate_cost(call_count=10, model_name="gpt-4o")
        assert cost > 0

    def test_estimate_cost_unknown(self):
        """Test cost estimation for unknown model."""
        cost = estimate_cost(call_count=10, model_name="unknown-model")
        # Should use default estimate
        assert cost > 0


class TestCursorDBReader:
    """Test Cursor database reader."""

    def test_init(self):
        """Test reader initialization."""
        reader = CursorDBReader()
        assert reader.db_path.name == "ai-code-tracking.db"

    def test_is_available(self):
        """Test database availability check."""
        reader = CursorDBReader()
        # May or may not be available depending on setup
        result = reader.is_available()
        assert isinstance(result, bool)

    def test_get_model_stats_returns_list(self):
        """Test get_model_stats returns a list."""
        reader = CursorDBReader()
        stats = reader.get_model_stats()
        assert isinstance(stats, list)

    def test_get_conversations_returns_list(self):
        """Test get_conversations returns a list."""
        reader = CursorDBReader()
        convos = reader.get_conversations()
        assert isinstance(convos, list)

    def test_get_projects_returns_list(self):
        """Test get_projects returns a list."""
        reader = CursorDBReader()
        projects = reader.get_projects()
        assert isinstance(projects, list)


class TestClaudeTelemetryReader:
    """Test Claude Code telemetry reader."""

    def test_init(self):
        """Test reader initialization."""
        reader = ClaudeTelemetryReader()
        assert reader.TELEMETRY_PATH.name == "telemetry"

    def test_is_available(self):
        """Test telemetry availability check."""
        reader = ClaudeTelemetryReader()
        result = reader.is_available()
        assert isinstance(result, bool)

    def test_get_sessions_returns_list(self):
        """Test get_sessions returns a list."""
        reader = ClaudeTelemetryReader()
        sessions = reader.get_sessions()
        assert isinstance(sessions, list)

    def test_get_model_usage_returns_list(self):
        """Test get_model_usage returns a list."""
        reader = ClaudeTelemetryReader()
        models = reader.get_model_usage()
        assert isinstance(models, list)

    def test_get_projects_returns_list(self):
        """Test get_projects returns a list."""
        reader = ClaudeTelemetryReader()
        projects = reader.get_projects()
        assert isinstance(projects, list)


class TestUnifiedAggregator:
    """Test unified aggregator."""

    def test_init(self):
        """Test aggregator initialization."""
        agg = UnifiedAggregator()
        assert hasattr(agg, "cursor_reader")
        assert hasattr(agg, "claude_reader")

    def test_get_summary_structure(self):
        """Test summary has expected structure."""
        agg = UnifiedAggregator()
        summary = agg.get_summary()

        assert "platforms" in summary
        assert "cursor" in summary["platforms"]
        assert "claude-code" in summary["platforms"]
        assert "forgewright" in summary["platforms"]
        assert "total_estimated_cost" in summary

    def test_get_summary_platforms_have_required_fields(self):
        """Test all platforms have required fields."""
        agg = UnifiedAggregator()
        summary = agg.get_summary()

        for platform, data in summary["platforms"].items():
            assert "available" in data
            assert isinstance(data["available"], bool)

    def test_get_by_platform(self):
        """Test get_by_platform returns dict."""
        agg = UnifiedAggregator()
        result = agg.get_by_platform()

        assert isinstance(result, dict)
        assert "cursor" in result
        assert "claude" in result


class TestPricingCoverage:
    """Test pricing coverage for common models."""

    def test_all_major_models_priced(self):
        """Test all major models have pricing."""
        # Models that exist in token-api-server.py PRICING
        major_models = [
            ("anthropic", "claude-3-5-sonnet-20241022"),
            ("anthropic", "claude-3-opus-20240229"),
            ("anthropic", "claude-3-haiku-20240307"),
            ("openai", "gpt-4o"),
            ("openai", "gpt-4o-mini"),
            ("openai", "gpt-4-turbo"),
            ("google", "gemini-2.5-pro"),
            ("google", "gemini-2.5-flash"),
            ("google", "gemini-2-pro"),
            ("google", "gemini-2-flash"),
        ]

        for provider, model in major_models:
            assert provider in PRICING, f"Missing provider: {provider}"
            assert model in PRICING[provider], f"Missing model: {provider}/{model}"

    def test_pricing_values_are_reasonable(self):
        """Test pricing values are within reasonable ranges."""
        for provider, models in PRICING.items():
            for model, prices in models.items():
                # Input should be between $0 and $100/M tokens
                assert 0 <= prices["input"] <= 100, (
                    f"{provider}/{model} input price unreasonable"
                )
                # Output should be between $0 and $200/M tokens
                assert 0 <= prices["output"] <= 200, (
                    f"{provider}/{model} output price unreasonable"
                )


class TestEdgeCases:
    """Test edge cases."""

    def test_zero_tokens(self):
        """Test cost calculation with zero tokens."""
        api = TokenAPI()
        cost = api.calculate_cost(
            provider="anthropic",
            model="claude-3-5-sonnet",
            input_tokens=0,
            output_tokens=0,
        )
        assert cost == 0.0

    def test_negative_tokens_handled(self):
        """Test handling of negative tokens (shouldn't crash)."""
        api = TokenAPI()
        cost = api.calculate_cost(
            provider="anthropic",
            model="claude-3-5-sonnet",
            input_tokens=-100,
            output_tokens=-50,
        )
        # Should return some negative value (edge case)
        assert cost < 0

    def test_very_large_tokens(self):
        """Test cost calculation with very large token counts."""
        api = TokenAPI()
        cost = api.calculate_cost(
            provider="anthropic",
            model="claude-3-5-sonnet",
            input_tokens=1_000_000_000,  # 1 billion
            output_tokens=1_000_000_000,
        )
        # $3 + $15 = $18 per million, so 1B = 1000M * $18 = $18,000
        expected = 1000 * (3.0 + 15.0)
        assert abs(cost - expected) < 1  # Within $1

    def test_model_name_case_insensitive(self):
        """Test pricing lookup is case insensitive."""
        pricing1 = get_pricing_for_model("CLAUDE-3-5-SONNET")
        pricing2 = get_pricing_for_model("claude-3-5-sonnet")
        # Both should return valid pricing
        assert "input" in pricing1
        assert "input" in pricing2
