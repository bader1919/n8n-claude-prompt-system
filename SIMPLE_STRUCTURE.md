# Simplified Project Structure for Main Branch

This document outlines the essential directories and files to be kept in the main branch of the repository. It is designed as a beginner-friendly guide to maintain a clean and manageable project structure.

## Essential Directories and Files

1. **templates/**
   - Contains templates for various operations.
   - Subdirectories:
     - **business_operations/**: Templates related to business processes.
     - **content_creation/**: Templates for content generation.

2. **n8n-workflows/**
   - Contains only basic workflows necessary for core functionality.
   - Advanced or experimental workflows should be removed.

3. **config/**
   - Contains configuration files.
   - Keep only `basic-config.json` for essential configuration.

4. **examples/**
   - Contains simplified example files demonstrating basic usage.
   - Remove complex or advanced examples.

5. **variables/**
   - Contains basic variable definitions.
   - Remove any advanced or unnecessary variable files.

6. **schemas/**
   - Contains schema definitions used in the project.

## Cleanup Guidelines

- Remove all references to advanced features, experimental workflows, and complex configurations.
- Ensure the README and other documentation reflect this simplified structure.
- Keep the main branch focused on beginner-friendly content and essential functionality.

## Summary

This structure helps new users to easily understand and contribute to the project without being overwhelmed by advanced features. It also facilitates easier maintenance and clearer project organization.