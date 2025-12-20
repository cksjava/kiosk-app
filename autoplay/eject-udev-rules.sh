sudo tee /etc/udev/rules.d/99-audio-cd.rules <<"EOF"
ACTION=="change", SUBSYSTEM=="block", ENV{ID_CDROM_MEDIA_AUDIO}=="1", RUN+="/usr/local/bin/cd-autoplay.sh"
ACTION=="change", SUBSYSTEM=="block", ENV{ID_CDROM_MEDIA}=="", RUN+="/usr/local/bin/cd-stop.sh"
EOF
sudo udevadm control --reload-rules
