terraform {
  required_version = ">= 1.0.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.0.0"
    }
  }
}

provider "oci" {}

# Get Availability Domains in the region
data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_ocid
}

# Find latest Canonical Ubuntu 22.04 LTS image matching shape
data "oci_core_images" "ubuntu_images" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = var.instance_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# 1. Virtual Cloud Network (VCN)
resource "oci_core_vcn" "movy_vcn" {
  compartment_id = var.compartment_ocid
  cidr_block     = "10.0.0.0/16"
  display_name   = "movy-stremio-vcn"
  dns_label      = "movyvcn"
}

# 2. Internet Gateway
resource "oci_core_internet_gateway" "movy_igw" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.movy_vcn.id
  display_name   = "movy-internet-gateway"
  enabled        = true
}

# 3. Route Table
resource "oci_core_route_table" "movy_rt" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.movy_vcn.id
  display_name   = "movy-route-table"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.movy_igw.id
  }
}

# 4. Security List (Allow ports 80, 443, 22)
resource "oci_core_security_list" "movy_sl" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.movy_vcn.id
  display_name   = "movy-security-list"

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
    stateless   = false
  }

  ingress_security_rules {
    protocol    = "6" # TCP
    source      = "0.0.0.0/0"
    stateless   = false
    description = "Allow HTTP for Let's Encrypt ACME"

    tcp_options {
      min = 80
      max = 80
    }
  }

  ingress_security_rules {
    protocol    = "6" # TCP
    source      = "0.0.0.0/0"
    stateless   = false
    description = "Allow HTTPS for Stremio Addon"

    tcp_options {
      min = 443
      max = 443
    }
  }

  ingress_security_rules {
    protocol    = "6" # TCP
    source      = "0.0.0.0/0"
    stateless   = false
    description = "Allow SSH management"

    tcp_options {
      min = 22
      max = 22
    }
  }
}

# 5. Public Subnet
resource "oci_core_subnet" "movy_subnet" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.movy_vcn.id
  cidr_block                 = "10.0.1.0/24"
  display_name               = "movy-public-subnet"
  dns_label                  = "movysubnet"
  route_table_id             = oci_core_route_table.movy_rt.id
  security_list_ids          = [oci_core_security_list.movy_sl.id]
  prohibit_public_ip_on_vnic = false
}

# 6. Cloud-Init Boot Script
locals {
  cloud_init = <<-EOF
    #!/bin/bash
    set -e
    exec > /var/log/movy-bootstrap.log 2>&1

    echo "=== Starting Movy Addon Auto-Deployment ==="

    # 1. Update OS firewall to allow ports 80 & 443
    iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT || true
    iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT || true
    which netfilter-persistent && netfilter-persistent save || true
    which ufw && ufw allow 80/tcp && ufw allow 443/tcp || true

    # 2. Install Docker
    if ! which docker; then
      curl -fsSL https://get.docker.com | sh
      systemctl enable docker
      systemctl start docker
    fi

    # 3. Detect Public IP & Domain
    PUBLIC_IP=""
    for i in {1..10}; do
      PUBLIC_IP=$(curl -s https://api.ipify.org || curl -s https://ifconfig.me || echo "")
      if [ -n "$PUBLIC_IP" ]; then break; fi
      sleep 2
    done

    if [ -n "$PUBLIC_IP" ]; then
      DOMAIN="$${PUBLIC_IP}.sslip.io"
    else
      DOMAIN="localhost"
    fi

    echo "Public IP: $PUBLIC_IP"
    echo "Domain: $DOMAIN"

    # 4. Clone Addon Repository
    mkdir -p /opt/movy-stremio-addon
    cd /opt/movy-stremio-addon
    git clone https://github.com/charlietrp77-cmd/movy-stremio-addon.git .

    # 5. Write Environment Configuration
    cat <<ENVEOF > .env
    DOMAIN=$${DOMAIN}
    ACCESS_KEY=${var.access_key}
    PORT=7000
    CADDY_HTTPS_PORT=443
    ENVEOF

    # 6. Start Docker Containers
    docker compose up -d --build

    echo "=== Deployment Finished Successfully ==="
  EOF
}

# 7. Compute Instance (Always Free)
resource "oci_core_instance" "movy_vm" {
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  compartment_id      = var.compartment_ocid
  display_name        = "movy-stremio-addon"
  shape               = var.instance_shape

  dynamic "shape_config" {
    for_each = length(regexall("Flex", var.instance_shape)) > 0 ? [1] : []
    content {
      ocpus         = var.ocpus
      memory_in_gbs = var.memory_in_gbs
    }
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.movy_subnet.id
    display_name     = "movy-vnic"
    assign_public_ip = true
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu_images.images[0].id
  }

  metadata = {
    ssh_authorized_keys = var.ssh_public_key != "" ? var.ssh_public_key : null
    user_data           = base64encode(local.cloud_init)
  }
}
