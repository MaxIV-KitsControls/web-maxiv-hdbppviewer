############################################################
# Dockerfile to build a deployment container for hdbppviewer
# Based on Ubuntu and miniconda
############################################################

# To build an image, e.g.:
# $ docker build -t hdbppviewer .
# (Note that this will take some time because we're building the
#  cassandra driver from source, see below.)
#
# To run it, e.g.:
# $ docker run --name hdbppviewer1 -p 80:5005 hdbppviewer
#

# Set the base image to Ubuntu
FROM continuumio/miniconda3

# File Author / Maintainer
MAINTAINER Johan Forsberg

# set the proper timezone
# This is important or the viewer won't query correctly!
RUN echo "Europe/Stockholm" > /etc/timezone 
RUN dpkg-reconfigure -f noninteractive tzdata

RUN conda install datashader

RUN apt-get update

# Need compiler for building the cassandra driver
# (TODO: make a conda package for the driver!)
RUN apt-get -y install build-essential 

RUN pip install aiohttp aiohttp_cors aiohttp_utils
RUN pip install cassandra-driver --install-option="--no-cython"
# check out the code
# (TODO: should get a specific version!)
RUN git clone https://github.com/MaxIV-KitsControls/web-maxiv-hdbppviewer.git 

# Copy the local config file into the checkout
# This allows customization of e.g. cluster setup
COPY hdbppviewer.conf web-maxiv-hdbppviewer/

# run the web service
EXPOSE 5005
WORKDIR web-maxiv-hdbppviewer
CMD python server.py
