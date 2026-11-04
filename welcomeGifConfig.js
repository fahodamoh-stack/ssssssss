module.exports = {
  channelId: "1567429021707538562",

  rulesChannelId: "1539365749418762311",
  chatChannelId: "1560996836808855593",

  // Put your uploaded image beside main.js with this name.
  backgroundImage: "./welcome-background.png",

  title: "Welcome to Milan",
  greeting: "Welcome cutyy",

  // Optional: local .ttf or .otf font supporting Arabic and Latin.
  // Example: "./fonts/your-font.ttf"
  fontPath: null,

  // Used if fontPath is null or the font cannot be loaded.
  fontFamily: "Arial",

  // Output height follows the background aspect ratio.
  width: 720,

  frames: 24,
  frameDelay: 60,

  // 0 = original brightness, 1 = completely black.
  backgroundDarkness: 0.38,

  colors: {
    text: "#f1eeee",
    secondaryText: "#ddd3d3",
    crimson: "#a81928",
    border: "#b22432",
    panel: "rgba(8, 7, 9, 0.60)",
    panelBorder: "rgba(176, 35, 48, 0.40)",
  },
};