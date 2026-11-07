# Lane U status

- Works: the menu in the left pane folds to one row of dish thumbnails and the dish count when the first chat message arrives. A thumbnail or the count opens the full grid. Checked in the browser with `?seed=1` and `?replay=1`.
- Faked: nothing. Thumbnails use the same photo source as DishCard.
- Note: in the normal flow, v1 arrives with chat messages, so the menu starts folded. The sticky canvas header is now `z-20`, so DishCard buttons no longer paint over it.
