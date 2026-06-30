# Background images

Drop your images into THIS folder (frontend/public/):

    frontend/public/background_dark.png
    frontend/public/background_light.png

Vite copies everything in public/ directly to the build output root,
so they'll be served at /background_dark.png and /background_light.png.

Recommended image specs:
- Size:    1920×1080 or larger (2560×1440 ideal for retina)
- Format:  PNG or JPG (PNG for sharp edges, JPG for photos)
- Content: Something that works behind a frosted glass overlay
           — landscapes, gradients, abstract textures all work well

The CSS already handles:
- Dark theme:  brightness(0.55) so the image doesn't overpower the glass
- Light theme: brightness(0.92) for a subtler effect
- background-size: cover  → always fills the viewport
- background-attachment: fixed  → parallax scroll effect
