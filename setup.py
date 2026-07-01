from setuptools import setup, find_packages

setup(
    name="ra1000-calculator",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "pandas",
        "requests",
        "openpyxl"
    ],
    entry_points={
        "console_scripts": [
            "ra1000=ra1000_calculator.cli:main",
        ],
    },
    author="Xavier M",
    description="Calculates the exact geographic point an aircraft reaches 1000ft Radio Altitude on approach.",
    python_requires=">=3.7",
)
