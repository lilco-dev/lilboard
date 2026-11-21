# @lilco/ui

Tiny Club’s shared UI, first used by lilboard. The colors and fonts are plain
CSS custom properties, independent of React. Static and server-rendered apps
can use `tokens.css` without importing any components.

For a React 19 app in this workspace, add `"@lilco/ui": "workspace:*"` to its
dependencies. Import the styles once at the root:

```tsx
import "@lilco/ui/tokens.css";
import "@lilco/ui/styles.css";
import { Inspector, Masthead, NavGroup, NavLink, Workspace } from "@lilco/ui";
```

The components render without client-side JavaScript. Consumers need a
bundler that compiles TSX; lilboard uses Next’s `transpilePackages`. The
package is private for now. Keep board data, routing, and page layouts in
the app; add a primitive here when another screen can reuse it.
