output "public_ip" {
  description = "The public IP address of the instance"
  value       = oci_core_instance.movy_vm.public_ip
}

output "hostname" {
  description = "Automated SSL Hostname (sslip.io)"
  value       = "https://${oci_core_instance.movy_vm.public_ip}.sslip.io"
}

output "stremio_manifest_url" {
  description = "🎉 Protected Stremio Manifest URL - Copy and paste this directly into Stremio!"
  value       = "https://${oci_core_instance.movy_vm.public_ip}.sslip.io/${var.access_key}/manifest.json"
}

output "ssh_command" {
  description = "Command to SSH into your VM (if SSH key was provided)"
  value       = "ssh ubuntu@${oci_core_instance.movy_vm.public_ip}"
}
