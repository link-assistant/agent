"""Basic usage example for my-package.

This example demonstrates the basic functionality of the package.
"""

from __future__ import annotations

import asyncio

from my_package import add, delay, multiply


def main() -> None:
    """Run basic examples."""
    # Example 1: Basic arithmetic
    print("Example 1: Basic arithmetic")
    print(f"2 + 3 = {add(2, 3)}")
    print(f"2 * 3 = {multiply(2, 3)}")
    print()

    # Example 2: Working with floats
    print("Example 2: Working with floats")
    print(f"2.5 + 3.5 = {add(2.5, 3.5)}")
    print(f"2.5 * 2 = {multiply(2.5, 2)}")
    print()


async def async_example() -> None:
    """Run async examples."""
    print("Example 3: Async delay")
    print("Waiting for 1 second...")
    await delay(1.0)
    print("Done!")
    print()


if __name__ == "__main__":
    main()
    asyncio.run(async_example())
