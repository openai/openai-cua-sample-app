async (saved) => {
    const hash = async (pixels) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(pixels)),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
    const newCanvas = () => {
      const canvas = document.createElement("canvas");
      canvas.width = saved.width;
      canvas.height = saved.height;
      return canvas;
    };
    const decode = async (png) => {
      const image = new Image();
      image.src = png;
      await image.decode();
      if (
        image.naturalWidth !== saved.width ||
        image.naturalHeight !== saved.height
      )
        throw new Error("Saved PNG dimensions are incorrect.");
      const canvas = newCanvas();
      canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
      return canvas;
    };
    const composite = newCanvas(),
      ctx = composite.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, saved.width, saved.height);
    for (const layer of saved.layers) {
      const canvas = await decode(layer.png),
        pixels = canvas
          .getContext("2d", { willReadFrequently: true })
          .getImageData(0, 0, saved.width, saved.height).data;
      if ((await hash(pixels)) !== layer.pixelHash)
        return {
          valid: false,
          reason: "A saved layer image does not match its pixel hash.",
        };
      if (layer.visible) {
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(canvas, 0, 0);
      }
    }
    const decoded = await decode(saved.compositePng),
      pixels = decoded
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, saved.width, saved.height).data;
    const compositePixels = ctx.getImageData(
      0,
      0,
      saved.width,
      saved.height,
    ).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255)
        count++;
    const decodedHash = await hash(pixels);
    const valid =
      decodedHash === saved.compositePixelHash &&
      (await hash(compositePixels)) === decodedHash &&
      count === saved.paintedPixelCount;
    return {
      valid,
      reason:
        "The saved PNG is inconsistent with the saved layers or pixel metadata.",
    };
  }
