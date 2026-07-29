module.exports = {
  default: {
    paths: ["features/**/*.feature"],
    import: ["e2e/support/**/*.ts", "e2e/steps/**/*.ts"],
    format: ["progress"],
  },
};
