VERSION = 1.0.0

build:
	docker build . -t docker.maxiv.lu.se/hdbppviewer:latest -t docker.maxiv.lu.se/hdbppviewer:$(VERSION)

publish:
	docker push docker.maxiv.lu.se/hdbppviewer