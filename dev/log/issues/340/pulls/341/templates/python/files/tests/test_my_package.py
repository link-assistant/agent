"""Example test file using pytest.

Tests for the my_package module.
"""

from __future__ import annotations

import pytest

from my_package import add, delay, multiply


class TestAdd:
    """Tests for add function."""

    def test_add_positive_numbers(self) -> None:
        """Test adding two positive numbers."""
        assert add(2, 3) == 5

    def test_add_negative_numbers(self) -> None:
        """Test adding negative numbers."""
        assert add(-1, -2) == -3

    def test_add_zero(self) -> None:
        """Test adding zero."""
        assert add(5, 0) == 5

    def test_add_floats(self) -> None:
        """Test adding floating point numbers."""
        assert add(2.5, 3.5) == 6.0


class TestMultiply:
    """Tests for multiply function."""

    def test_multiply_positive_numbers(self) -> None:
        """Test multiplying two positive numbers."""
        assert multiply(2, 3) == 6

    def test_multiply_by_zero(self) -> None:
        """Test multiplying by zero."""
        assert multiply(5, 0) == 0

    def test_multiply_negative_numbers(self) -> None:
        """Test multiplying negative numbers."""
        assert multiply(-2, 3) == -6

    def test_multiply_floats(self) -> None:
        """Test multiplying floating point numbers."""
        assert multiply(2.5, 2) == 5.0


class TestDelay:
    """Tests for delay function."""

    @pytest.mark.asyncio
    async def test_delay(self) -> None:
        """Test async delay function."""
        import time

        start = time.time()
        await delay(0.1)
        elapsed = time.time() - start
        assert elapsed >= 0.1
