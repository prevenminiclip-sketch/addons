# Movy.sx Stremio Addon (Self-Contained Stack)

A completely self-contained stack with **Movy.sx Stremio Addon** and **Caddy** (Automated Let's Encrypt SSL with DuckDNS or sslip.io).

- **100% Standalone:** No external network dependencies, no other stacks required.
- **HLS Multi-Stream Accelerator:** Multi-connection pipeline prefetching upcoming segments in parallel into an in-memory ring buffer (eliminates buffering on high-bitrate streams).
- **Automated SSL:** Caddy acquires and auto-renews trusted Let's Encrypt certificates via standard HTTP-01 (`sslip.io` / custom domain) or DNS-01 (`DuckDNS`).
- **Direct 4K/1080p HLS Streams:** Playable directly in Stremio Web (`web.stremio.com`), Android TV, FireStick, iOS, and Desktop.
- **Instance Security (Secret Access Token):** Built-in token protection (`ACCESS_KEY`) preventing scanners, bots, or unauthorized users from leeching your instance bandwidth.
- **Network Hardened:** Container port 7000 is bound strictly to `127.0.0.1`, ensuring all external traffic must route securely through HTTPS.

---

## 📁 Stack Structure

```text
movy-stremio-addon/
├── cloudformation.yaml         # Official AWS CloudFormation 1-Click Template (EC2 Free Tier)
├── oci-resource-manager/       # OCI Resource Manager Stack (Terraform + schema.yaml)
│   ├── main.tf                 # Complete VCN, Subnet, Security List, & VM provisioning
│   ├── variables.tf            # Parametrized configuration (Access Key, Shape, RAM)
│   ├── outputs.tf              # Outputs the final Stremio manifest URL
│   └── schema.yaml             # OCI Console UI descriptor
├── movy-oci-stack.zip          # Ready-to-upload OCI Resource Manager stack package
├── docker-compose.yml          # Compose specification (localhost hardened)
├── portainer-stack.yml         # Portainer-ready Stack file
├── Dockerfile                  # Lightweight Node 20 standalone image (zero build overhead)
├── Dockerfile.caddy            # Dual-mode Caddy builder (sslip.io / DuckDNS)
├── entrypoint-caddy.sh         # Auto-SSL generator script
├── deploy-oci.sh               # 1-Click manual setup script
├── .env.example                # Example configuration
└── src/                        # Reversed cipher, HLS accelerator, & Stremio server
```

---

## ⚡ Option A: AWS CloudFormation (1-Click Deployment - Recommended)

AWS Free Tier includes 750 hours/month of EC2 (`t3.micro`), and AWS has a dedicated **South Africa (Cape Town - `af-south-1`)** region with low local latency.

Our CloudFormation template ([`cloudformation.yaml`](cloudformation.yaml)) handles **100% of the provisioning automatically**:
- Dedicated isolated VPC, Public Subnet, Internet Gateway & Route Tables
- Security Group with ports 80 & 443 open
- Canonical Ubuntu 22.04 LTS EC2 instance (`t3.micro` Free Tier)
- Auto-bootstrapping script: Installs Docker, configures `<PUBLIC_IP>.sslip.io`, acquires automated Let's Encrypt SSL, and starts the streaming stack
- Direct **Outputs** tab in AWS Console showing your ready-to-use Stremio URL!

### How to Deploy in AWS:

1. Log into your [AWS Management Console](https://console.aws.amazon.com).
2. In the top-right corner, select your desired region:
   - **Africa (Cape Town)** `af-south-1` *(If prompted to enable the region in Account Settings, enable it)*
   - *Or* any default region like **Europe (Frankfurt)** `eu-central-1` / **Europe (Ireland)** `eu-west-1`.
3. In the search bar at the top, type **CloudFormation** and open it.
4. Click **Create stack** ➔ **With new resources (standard)**.
5. Under **Specify template**:
   - Choose **Upload a template file**.
   - Click **Choose file** and select [`cloudformation.yaml`](cloudformation.yaml) from this folder.
   - Click **Next**.
6. **Specify stack details**:
   - **Stack name:** `movy-stremio-addon`
   - **AccessKey:** Enter your secret token (e.g. `mysecret889`).
   - Click **Next**.
7. Click **Next** on Configure stack options ➔ Scroll to the bottom and click **Submit**.
8. CloudFormation will display `CREATE_IN_PROGRESS` and turn to `CREATE_COMPLETE` in ~2 minutes.
9. Click the **Outputs** tab of your stack:
   - Copy your **`StremioManifestUrl`**:
     ```text
     https://<YOUR-AWS-IP>.sslip.io/mysecret889/manifest.json
     ```
10. Paste into Stremio and enjoy instant, smooth streaming!

---

## ☁️ Option B: OCI Resource Manager (Oracle Cloud)

Oracle Cloud's direct equivalent of AWS CloudFormation is **OCI Resource Manager**. We've provided a complete Terraform stack (`movy-oci-stack.zip`) that automatically provisions everything in your Oracle account:
- Dedicated VCN & Public Subnet
- Internet Gateway & Route Tables
- Cloud Security List (opens ports 80 & 443)
- Always-Free Ubuntu ARM VM
- Cloud-init script that automatically installs Docker, configures `<IP>.sslip.io` with Let's Encrypt HTTPS, starts the addon, and prints your Stremio URL in the console.

### How to Deploy via OCI Resource Manager:

1. Log in to your [Oracle Cloud Console](https://cloud.oracle.com) and set region to **South Africa (Johannesburg)** (`af-johannesburg-1`).
2. Open the navigation menu (☰) ➔ **Developer Services** ➔ **Resource Manager** ➔ **Stacks**.
3. Click **Create Stack**.
4. Under **Stack configuration**:
   - Select **.ZIP file** and upload `movy-oci-stack.zip` (located in this repo).
   - *Or* select **Source code control system** ➔ Git repository: `https://github.com/charlietrp77-cmd/movy-stremio-addon.git` (Working directory: `oci-resource-manager`).
5. Click **Next**.
6. In the UI form:
   - **Secret Access Key:** Enter your chosen secret password (e.g. `mysecret889`).
   - **Compartment:** Select your compartment (usually your root/default tenancy compartment).
   - **SSH Public Key:** Optional (can be left blank).
7. Click **Next** ➔ Check the box **Run apply** ➔ Click **Create**.
8. OCI will automatically run the plan and apply. Within ~2-3 minutes, click **Outputs** on the left menu:
   - Your `stremio_manifest_url` will be printed right on screen!
   - Example: `https://129.151.77.20.sslip.io/mysecret889/manifest.json`.

---

## ☁️ Option B: Manual VM + 1-Click Script (deploy-oci.sh)

Oracle Cloud provides **Always Free** ARM instances (up to 4 OCPUs, 24GB RAM, 10TB/month outbound bandwidth, and a free static IP) in Johannesburg (`af-johannesburg-1`).

### Step 1: Create an Instance in OCI
1. Log in to your Oracle Cloud Console.
2. Ensure your region is set to **South Africa (Johannesburg)** (`af-johannesburg-1`).
3. Go to **Compute** ➔ **Instances** ➔ **Create instance**.
4. **Name:** `movy-stremio-addon`
5. **Image and Shape:**
   - **Image:** Ubuntu 22.04 LTS or 24.04 LTS (Canonical Ubuntu).
   - **Shape:** `Ampere VM.Standard.A1.Flex` (e.g. 2 OCPUs, 12 GB RAM) or `VM.Standard.E2.1.Micro` (1 OCPU, 1 GB RAM). Both are Always Free.
6. **Networking:**
   - Select your Default VCN & Public Subnet.
   - Ensure **Assign a public IPv4 address** is checked.
7. **SSH keys:**
   - Click **Save private key** (to your PC) so you can connect via SSH.
8. Click **Create**.

---

### Step 2: Assign a Free Static (Reserved) Public IP
1. On your instance page, scroll down to **Attached VNICs** (left menu) ➔ click the VNIC name.
2. Under **Resources**, click **IPv4 Addresses**.
3. Click the three dots `...` on the right of your IP ➔ **Edit**.
4. Change **Public IP Type** from *Ephemeral* to **Reserved public IP**.
5. Select **Create new reserved public IP** and click **Update**.
6. Copy your permanent static IP address (e.g. `129.151.x.y`).

---

### Step 3: Open Firewall Ports in OCI Security List
1. In OCI, go to **Networking** ➔ **Virtual Cloud Networks** ➔ click your VCN.
2. Click **Security Lists** ➔ click **Default Security List for...**.
3. Under **Ingress Rules**, click **Add Ingress Rules**:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** TCP
   - **Destination Port Range:** `80, 443`
   - **Description:** Allow HTTP and HTTPS
4. Click **Add Ingress Rules**.

---

### Step 4: 1-Click Deployment via SSH

1. Connect to your OCI instance via SSH:
   ```bash
   ssh -i your_private_key.key ubuntu@YOUR_STATIC_IP
   ```

2. Run the 1-click deployment command:
   ```bash
   git clone https://github.com/charlietrp77-cmd/movy-stremio-addon.git
   cd movy-stremio-addon
   chmod +x deploy-oci.sh
   ./deploy-oci.sh
   ```

The script will automatically:
- Open ports 80 & 443 in the Ubuntu OS firewall (`iptables`).
- Install Docker & Docker Compose.
- Auto-detect your static IP and set your zero-config hostname (`<YOUR-STATIC-IP>.sslip.io`).
- Generate a secure `ACCESS_KEY` (or you can specify `ACCESS_KEY=mykey ./deploy-oci.sh`).
- Start Caddy and the addon with automatic Let's Encrypt SSL.
- Output your ready-to-use Stremio manifest URL!

---

## 🚀 Portainer Deployment (Alternative)

If you already run Portainer on your server:

1. In Portainer, go to **Stacks** ➔ **Add stack**.
2. Name: `movy-stremio-addon`
3. Build method: **Repository**
4. Repository URL:
   ```text
   https://github.com/charlietrp77-cmd/movy-stremio-addon.git
   ```
5. Reference: `refs/heads/main`
6. Compose path: `docker-compose.yml`
7. In **Environment variables**, set either:
   - **Option A (Zero-config sslip.io):**
     - `DOMAIN=<YOUR_STATIC_IP>.sslip.io`
     - `ACCESS_KEY=your_secret_token_here`
   - **Option B (DuckDNS):**
     - `DUCKDNS_DOMAIN=yourdomain.duckdns.org`
     - `DUCKDNS_TOKEN=your_token`
     - `ACCESS_KEY=your_secret_token_here`
8. Click **Deploy the stack**.

---

## 📺 Stremio Manifest URL

Paste your clean HTTPS manifest URL directly into Stremio's search bar:

- **Protected (Recommended):**
  ```text
  https://<YOUR_DOMAIN>/your_secret_token_here/manifest.json
  ```
- **Public:**
  ```text
  https://<YOUR_DOMAIN>/manifest.json
  ```
