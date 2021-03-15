############################################################
# Dockerfile to build a deployment container for hdbppviewer
# Based on Ubuntu and mambaforge
############################################################

# To build an image, e.g.:
# $ docker build -t hdbppviewer .
#
# To run it, e.g.:
# $ docker run --name hdbppviewer1 -p 80:5005 hdbppviewer

FROM condaforge/mambaforge:4.9.2-5

# set the proper timezone
# This is important or the viewer won't query correctly!
ENV DEBIAN_FRONTEND noninteractive
RUN ln -sf /usr/share/zoneinfo/Europe/Stockholm /etc/localtime
RUN apt-get update \
  && apt-get -y install tzdata \
  && dpkg-reconfigure -f noninteractive tzdata \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -r -g 1000 kits \
  && useradd --no-log-init -r -g kits -u 1000 kits

COPY environment.yaml /tmp/environment.yaml
RUN mamba env create --name hdbviewer --file=/tmp/environment.yaml \
  && conda clean -afy

COPY --chown=kits:kits . /app

# run the web service
EXPOSE 5005
WORKDIR /app
ENV NUMBA_CACHE_DIR=/tmp
ENV PATH=/opt/conda/envs/hdbviewer/bin:$PATH

CMD ["python", "server.py", "-c", "hdbppviewer.conf"]

USER kits
