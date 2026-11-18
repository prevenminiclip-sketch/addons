variable "compartment_ocid" {
  type        = string
  description = "The OCID of the compartment where resources will be created."
}

variable "access_key" {
  type        = string
  description = "Secret Access Key protecting the addon from unauthorized users and crawlers."
  default     = "movy_secret_pass"
}

variable "ssh_public_key" {
  type        = string
  description = "Optional SSH Public Key (e.g. ssh-rsa ...). Leave empty if you don't need SSH access."
  default     = ""
}

variable "instance_shape" {
  type        = string
  description = "OCI Compute shape (Always Free: VM.Standard.A1.Flex or VM.Standard.E2.1.Micro)."
  default     = "VM.Standard.A1.Flex"
}

variable "ocpus" {
  type        = number
  description = "Number of OCPUs for Flex shapes (1 to 4 Always Free)."
  default     = 2
}

variable "memory_in_gbs" {
  type        = number
  description = "Memory in GBs for Flex shapes (6 to 24 GB Always Free)."
  default     = 12
}
