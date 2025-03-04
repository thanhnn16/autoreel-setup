# Fork from [MIAI_n8n_dockercompose](https://github.com/thangnch/MIAI_n8n_dockercompose)

## Install
``` sh
curl -s -o install.sh https://raw.githubusercontent.com/thanhnn16/autoreel-setup/main/install.sh
chmod +x install.sh
sudo ./install.sh
```

## Start all services
``` sh
docker compose --profile gpu-nvidia --profile localai --profile n8n up -d
```

## Stop all services
``` sh
docker compose --profile gpu-nvidia --profile localai --profile n8n down
```

