"""Simple Python fixture for testing."""

import os
from typing import List


class Config:
    """Application configuration."""
    name: str = "default"
    debug: bool = False


class Service:
    """Simple service class."""

    def __init__(self, config: Config):
        self.config = config

    def run(self) -> str:
        return self.config.name

    def items(self) -> List[str]:
        return []
