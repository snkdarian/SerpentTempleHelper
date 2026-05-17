# Okey Card Assets

Put the 24 card template images in this folder as PNG files:

```text
yellow-1.png
yellow-2.png
yellow-3.png
yellow-4.png
yellow-5.png
yellow-6.png
yellow-7.png
yellow-8.png
red-1.png
red-2.png
red-3.png
red-4.png
red-5.png
red-6.png
red-7.png
red-8.png
blue-1.png
blue-2.png
blue-3.png
blue-4.png
blue-5.png
blue-6.png
blue-7.png
blue-8.png
```

Use clean crops from the game UI, one card per image. PNG is preferred.

You can also add the empty/replacing card state as:

```text
background-card.png
```

This image is used as a transition trigger: when a slot briefly matches it, the app waits for the new card to appear before running card detection for that slot.
