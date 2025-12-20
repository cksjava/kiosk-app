sudo tee /etc/udev/rules.d/99-audio-cd.rules << "EOF"
ACTION=="change", SUBSYSTEM=="block", KERNEL=="sr0", RUN+="/usr/bin/systemd-run --no-block /usr/local/bin/cd-autoplay.sh"
EOF
sudo udevadm control --reload-rules
