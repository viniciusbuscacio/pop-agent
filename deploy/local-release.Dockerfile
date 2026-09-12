FROM ubuntu:24.04@sha256:33ceb71981b602c1a7443a53469e4dba065f7503eab3078a2d7a57a2ab987517
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends ca-certificates curl git xz-utils tar unzip build-essential python3 ffmpeg sudo gh libgomp1 libstdc++6 && rm -rf /var/lib/apt/lists/*
RUN printf 'ubuntu ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/pop-builder && chmod 440 /etc/sudoers.d/pop-builder
ENV HOME=/cache/home
USER 1000:1000
WORKDIR /work
