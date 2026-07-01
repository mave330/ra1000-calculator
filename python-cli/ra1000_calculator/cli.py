import argparse
import sys
import pandas as pd
from ra1000_calculator.core import find_ra_crossings

def main():
    parser = argparse.ArgumentParser(description="Calculate the exact geographic point where an aircraft reaches 1000ft Radio Altitude on approach.")
    parser.add_argument("--original-csv", required=True, help="Path to the original CSV file.")
    parser.add_argument("--samples-csv", required=True, help="Path to the generated samples CSV file containing terrain profiles.")
    parser.add_argument("--target-ra", type=float, default=1000.0, help="Target Radio Altitude (default: 1000.0 ft).")
    parser.add_argument("--output", required=False, help="Path to save the output CSV. Defaults to stdout if not provided.")

    args = parser.parse_args()

    try:
        df_original = pd.read_csv(args.original_csv)
    except Exception as e:
        print(f"Error reading original CSV: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        df_samples = pd.read_csv(args.samples_csv)
    except Exception as e:
        print(f"Error reading samples CSV: {e}", file=sys.stderr)
        sys.exit(1)

    print("Running RA calculations...", file=sys.stderr)
    results = find_ra_crossings(df_original, df_samples, args.target_ra)

    if args.output:
        results.to_csv(args.output, index=False)
        print(f"Successfully saved to {args.output}", file=sys.stderr)
    else:
        print(results.to_csv(index=False))

if __name__ == "__main__":
    main()
