#!/usr/bin/env bash
#
# fetch-icons.sh - Download Iconify icons to local assets
#
# Usage: ./fetch-icons.sh lucide:search lucide:hammer ...
#
# Output:
#   - assets/icons/{collection}/{name}.svg
#   - assets/icons/index.json
#

# Resolve project root (4 levels up from script location)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
ICONS_DIR="$PROJECT_ROOT/assets/icons"
API_BASE="https://api.iconify.design"

# Colors
GREEN='\033[32m'
RED='\033[31m'
RESET='\033[0m'

# Counters
SUCCESS=0
FAILED=0

# Temporary file for index entries
INDEX_ENTRIES=""

# Ensure icons directory exists
mkdir -p "$ICONS_DIR"

# Helper: print result
log_result() {
    local status="$1"
    local message="$2"
    if [[ "$status" == "ok" ]]; then
        echo -e "${GREEN}OK${RESET}  $message"
        SUCCESS=$((SUCCESS + 1))
    else
        echo -e "${RED}FAIL${RESET} $message"
        FAILED=$((FAILED + 1))
    fi
}

# Helper: download single icon
download_icon() {
    local full_name="$1"

    # Parse collection:name
    if [[ ! "$full_name" =~ ^([^:]+):(.+)$ ]]; then
        log_result "fail" "$full_name (invalid format, use collection:name)"
        return 1
    fi

    local collection="${BASH_REMATCH[1]}"
    local name="${BASH_REMATCH[2]}"
    local output_dir="$ICONS_DIR/$collection"
    local output_path="$output_dir/$name.svg"

    # Create collection directory
    mkdir -p "$output_dir"

    # Download SVG
    local url="$API_BASE/$collection/$name.svg"
    local http_code
    http_code=$(curl -s -w "%{http_code}" -o "$output_path" "$url" 2>/dev/null) || http_code="000"

    # Check response
    if [[ "$http_code" == "200" && -s "$output_path" ]]; then
        # Verify it's actually SVG content
        if head -c 5 "$output_path" | grep -q "<svg"; then
            # Add to index entries
            if [[ -n "$INDEX_ENTRIES" ]]; then
                INDEX_ENTRIES="${INDEX_ENTRIES},"
            fi
            INDEX_ENTRIES="${INDEX_ENTRIES}\"$full_name\":\"icons/${collection}/${name}.svg\""
            log_result "ok" "$output_path"
            return 0
        else
            rm -f "$output_path"
            log_result "fail" "$full_name (not valid SVG)"
            return 1
        fi
    else
        rm -f "$output_path"
        log_result "fail" "$full_name ($http_code)"
        return 1
    fi
}

# Main: process all arguments
if [[ $# -eq 0 ]]; then
    echo "Usage: $0 collection:name [collection:name ...]"
    echo "Example: $0 lucide:search lucide:hammer"
    exit 1
fi

echo "Downloading icons to: $ICONS_DIR"
echo "---"

for icon in "$@"; do
    download_icon "$icon" || true
done

# Build index.json
INDEX_FILE="$ICONS_DIR/index.json"
cat > "$INDEX_FILE" << EOF
{
  $INDEX_ENTRIES
}
EOF

# Summary
echo "---"
echo "Done: $SUCCESS success, $FAILED failed"

# Exit with error if any failed
if [[ $FAILED -gt 0 ]]; then
    exit 1
fi