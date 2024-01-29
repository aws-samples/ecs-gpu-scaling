FROM nvcr.io/nvidia/k8s/dcgm-exporter:3.3.0-3.2.0-ubuntu22.04

WORKDIR /usr/src/app

RUN apt-get install -y ca-certificates && \
    apt-get update && \
    apt-get install -y python3 python3-pip

RUN pip install torch

COPY test.py .