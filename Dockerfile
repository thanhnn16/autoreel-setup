FROM n8nio/n8n:latest

USER root

RUN apk update && apk add --no-cache \
    python3 \
    py3-crcmod \
    bash \
    curl \
    tar \
    gzip \
    gcompat

RUN curl -O https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz && \
    tar -xf google-cloud-cli-linux-x86_64.tar.gz && \
    mv google-cloud-sdk /google-cloud-sdk && \
    /google-cloud-sdk/install.sh --quiet && \
    rm google-cloud-cli-linux-x86_64.tar.gz

# Thêm PATH và CLOUDSDK_CONFIG vào môi trường
ENV PATH="/google-cloud-sdk/bin:${PATH}"
ENV CLOUDSDK_CONFIG="/home/node/.config/gcloud"

USER node
