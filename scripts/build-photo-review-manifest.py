#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def canonical_url(value):
    if not value:
        return ""
    parts = urlsplit(value.strip())
    query = urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True)))
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip("/"), query, ""))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    prepared = json.loads(Path(args.report).read_text(encoding="utf-8"))
    source_results = {}
    for path in Path(args.source_dir).glob("*/result.json"):
        result = json.loads(path.read_text(encoding="utf-8"))
        result["archiveResult"] = str(path)
        source_results[canonical_url(result.get("requestedUrl"))] = result

    selected = []
    rejected = []
    for item in prepared.get("images", []):
        result = source_results.get(canonical_url(item.get("sourcePage")))
        evidence = [] if not result else [
            row for row in result.get("images", [])
            if row.get("placeNameFound") and canonical_url(row.get("sourceUrl")) == canonical_url(item.get("sourceUrl"))
        ]
        if result and result.get("success") and evidence:
            selected.append({
                **item,
                "sourceArchive": result["archiveResult"],
                "sourceResultUrl": result.get("resultUrl"),
                "sourceStatusCode": result.get("statusCode"),
                "identityEvidence": evidence[0],
                "reviewStatus": "pending",
                "reviewNotes": "",
            })
        else:
            rejected.append({
                "id": item.get("id"), "placeId": item.get("placeId"),
                "placeName": item.get("placeName"), "sourcePage": item.get("sourcePage"),
                "reason": "source-page identity not confirmed",
            })

    output = {
        "preparedReport": args.report,
        "sourceDirectory": args.source_dir,
        "pendingCount": len(selected),
        "rejectedCount": len(rejected),
        "images": selected,
        "rejected": rejected,
    }
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output_path), "pending": len(selected), "rejected": len(rejected)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
