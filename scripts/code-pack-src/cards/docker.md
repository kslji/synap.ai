---
language: docker
library: docker
version: original
source_url: https://synap.surf/code-pack/cards/docker
licence: CC0-1.0
title: Synap.surf Code pack
attribution: Original cards written for the Synap.surf Code pack
---

## Dockerfile CMD

Dockerfile CMD is the default command for a container. The exec form is a JSON array, for example CMD ["python", "app.py"]. The shell form is CMD python app.py and runs through a shell. ENTRYPOINT is the executable. A shell-form CMD runs through /bin/sh -c. Instructions are written in uppercase by convention. A later CMD replaces an earlier CMD.

## docker build

docker build -t name . builds an image from the Dockerfile in this directory. The final argument is the build context. Files listed in .dockerignore are left out of the context. The tag is the name you pass to docker run. docker build does not start the container.
