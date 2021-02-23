const path = require('path');

module.exports = {
  entry: "./js/main.js",
  output: {
    path: path.resolve(__dirname, 'static'),
    publicPath: '/static/',
    filename: "bundle.js"
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [{
          loader: "babel-loader",
          options: {
            presets: [
              "es2015",
              "stage-0", "stage-1", "stage-2", "stage-3",
              "react"
            ]
          }
        }]
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"]
      },
      {
        test: /\.(jpg|png)$/,
        use: {
          loader: 'url-loader',
        },
      },
    ]
  },
  resolve: {
    extensions: [".js"]
  },
  externals: {
    "d3": "d3"
  },
  devServer: {
    contentBase: './static',
    proxy: {
      '/': 'http://localhost:5005'
    },
    // port: 5005,
    watchContentBase: true
  }
};
