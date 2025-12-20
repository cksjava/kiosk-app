sudo tee /etc/udev/rules.d/99-audio-cd.rules <<"EOF"
ACTION=="change", SUBSYSTEM=="block", KERNEL=="sr0", ENV{ID_CDROM_MEDIA}=="1", RUN+="/usr/bin/systemd-run --no-block /usr/local/bin/cd-autoplay.sh"
ACTION=="change", SUBSYSTEM=="block", KERNEL=="sr0", ENV{ID_CDROM_MEDIA}!="1", RUN+="/usr/bin/systemd-run --no-block /usr/local/bin/cd-stop.sh"
EOF
sudo udevadm control --reload-rules
