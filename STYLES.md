# Style Preview Options

I've created 4 different header/menu style variations for your Hugo site. You can easily preview them using the included script.

## Available Styles

### 1. **Original** (Current)
- Brutalist minimalist design
- Monospace font, raw aesthetic
- Simple horizontal links
- No styling on header

### 2. **Centered** 
- Elegant centered layout
- Clean borders around navigation
- Better spacing and typography
- Uppercase menu items with hover borders

### 3. **Sidebar**
- Left sidebar navigation (sticky)
- Main content on the right
- Better for longer menus
- Collapses to top on mobile

### 4. **Cards**
- Card-based navigation blocks
- Hover lift effects
- Serif font (Georgia)
- Header in a card with background

## How to Preview

Run the preview script:

```bash
./preview-styles.sh [style-name]
```

Then start Hugo server:

```bash
hugo server -D
```

## Examples

```bash
# Try the centered style
./preview-styles.sh centered

# Try the sidebar style  
./preview-styles.sh sidebar

# Go back to original
./preview-styles.sh original
```

## Manual Switching

If you prefer, you can manually copy the head files:

```bash
# Switch to centered
cp themes/nostyleplease/layouts/partials/head-centered.html themes/nostyleplease/layouts/partials/head.html

# Rebuild
hugo
```

## Customizing Further

Each style has its own SCSS file in:
- `themes/nostyleplease/assets/css/main.scss` (original)
- `themes/nostyleplease/assets/css/main-centered.scss`
- `themes/nostyleplease/assets/css/main-sidebar.scss`
- `themes/nostyleplease/assets/css/main-cards.scss`

You can edit colors, fonts, spacing, etc. in these files.

## Current Status

The site is currently using the **original** style.
