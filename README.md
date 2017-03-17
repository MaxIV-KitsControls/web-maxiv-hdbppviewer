## Introduction

This is a web based viewer for HDB++ archive data, currently only supporting the Cassandra backend.

It is currently in a "beta" stage, with basic functionality in place but very limited testing. Bug reports are welcome!


## Features

### Basic functionality
* Searching for stored attributes
* Selecting which attributes to add
* Free scrolling/zooming the time scale in the plot
* Two separate Y axes (no hard restriction, but needs UI)
* Y axes autoscale
* Encodes current view in URL (e.g. for saving as a bookmark)
* Display min/max etc. on mouseover
* Linear and logarithmic Y axes
* Cache database queries in memory.

### Missing functionality
* Configure color, Y-axis etc for each line
* Periodical updates
* Display attribute configuration
* Display errors
* "Special" datatypes: String, Boolean, State, Spectrum, ...
* Cassandra authentication (?)
* General robustness
* Allow downloading "raw" data
* Displaying data as a table
* Manual scaling of Y axes.
* Rescale the UI when the window size changes
* Handling different keyspaces

### Improvements needed
* Optimize data readout and processing
* UI is pretty basic
* Mouseover stuff is a mess
* Server configuration
* Not sure about the url hash json stuff...

### Ideas
* Use websocket to send data incrementally?
* Use canvas for plotting
* Now re-loads the view each time anything changes, maybe possible to be smarter here?
* Would it be useful (or just confusing) to allow more than two Y-axes?
* Other ways of browsing for attributes; e.g. a tree?
* Mobile optimized view? The plot actually works pretty well on a mobile screen, but the rest is unusable as it is.


## Requirements

Note: the repo includes a Dockerfile, that can be used to build a docker container image for easy deployment together with all dependencies. Have a look in the file for instructions, you will probably need to modify some things to suit your needs.

### Python (for running)

 * python >= 3.5
 * aiohttp
 * cassandra-driver >= 3.6 (needs to be built with numpy support!)
 * datashader

Datashader has a bunch of scientific python dependencies, the easiest way to get it is probably through anaconda (https://www.continuum.io/downloads)


### Javascript (for frontend development)

 * node.js
 * npm
  

### Cassandra

You also, obviously, need to have access to a Cassandra installation somewhere, containing HDB++ formatted data.


## Building

The frontend is written using babel, react and redux and managed with webpack. To build it, the following steps should work:

$ npm install
$ webpack


## Configuration

By default, the server will load the config file "hdbppviewer.conf". It contains some example configuration and comments. You can create your own configuration file and put it wherever you like, and point the server to it using the "-c" argument.


## Running

$ python server.py

Then point a web browser at http://localhost:5005/index.html
