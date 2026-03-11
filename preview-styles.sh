#!/bin/bash

# Style Preview Script for Hugo Site
# Usage: ./preview-styles.sh [style-name]
# Available styles: original, centered, sidebar, cards

STYLE=${1:-original}
SITE_HEAD="layouts/partials/head.html"

case $STYLE in
  original)
    sed -i 's/css\/main-[^.]*\.scss/css\/main.scss/' "$SITE_HEAD"
    echo "Switched to: ORIGINAL (brutalist minimalist)"
    ;;
  centered)
    sed -i 's/css\/main[^"]*\.scss/css\/main-centered.scss/' "$SITE_HEAD"
    echo "Switched to: CENTERED (elegant centered navigation)"
    ;;
  sidebar)
    sed -i 's/css\/main[^"]*\.scss/css\/main-sidebar.scss/' "$SITE_HEAD"
    echo "Switched to: SIDEBAR (left sidebar navigation)"
    ;;
  cards)
    sed -i 's/css\/main[^"]*\.scss/css\/main-cards.scss/' "$SITE_HEAD"
    echo "Switched to: CARDS (card-based navigation blocks)"
    ;;
  *)
    echo "Usage: ./preview-styles.sh [style-name]"
    echo ""
    echo "Available styles:"
    echo "  original  - Current brutalist minimalist (default)"
    echo "  centered  - Elegant centered navigation with borders"
    echo "  sidebar   - Left sidebar navigation (desktop only)"
    echo "  cards     - Card-based navigation blocks"
    echo ""
    echo "Example: ./preview-styles.sh centered"
    exit 1
    ;;
esac

echo ""
echo "Now run 'hugo server' and refresh your browser to see the changes"
