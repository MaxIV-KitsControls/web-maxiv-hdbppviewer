module.exports = {
    entry: "./js/main.js",
    output: {
        path: __dirname + "/static/js",
        filename: "bundle.js"
    },
    module: {
        loaders: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                loader: "babel-loader",
                query: {
                    presets: [
                        "es2015",
                        "stage-0", "stage-1", "stage-2", "stage-3",
                        "react"] 
                }
            }
        ]
    },
    resolve: {
        extensions: [ "", ".js" ]
    },
    externals: {
        "d3": "d3"
    }
};
