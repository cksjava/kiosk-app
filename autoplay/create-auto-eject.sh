sudo tee /usr/local/bin/cd-stop.sh << "EOF"
#!/bin/bash
pkill -f "mpv cdda://"
EOF
sudo chmod +x /usr/local/bin/cd-stop.sh
