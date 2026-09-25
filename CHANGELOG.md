# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html),
and is managed by [Changelog](https://github.com/dworthen/changelog).

## 1.0.1 - 2026-09-25

### Fix

c067960: Remove force flag.

## 1.0.0 - 2026-09-19

### Change

95256cd: Refactor for v1 release.

## 0.3.1 - 2026-08-06

### Fix

d58f343: Add NPM release.

## 0.3.0 - 2026-08-04

### Add

3f5e91e: Add concurrency pattern with WorkerPool and Channel.
6f368ab: Download index entries on index add and add caching layer.

### Fix

9880a96: BC: Changed UserConfig indexes to string[] from Record<string, string>
2db4a7d: BC: Refactor Index type to be a list instead of a record. Add support for streaming over entries. Refactor cli commands to use new types
4153aed: BC: Rename ghd indexes commands to ghd index.
90121c1: BC: Change the IndexRecord type.
5122459: Update ghd index view formatting.
b6cbb39: Remove old installations on startup.

## 0.2.0 - 2026-07-27

### Add

50a1c82: Add ghd indexes list command.

## 0.1.0 - 2026-07-27

### Add

05db62d: Initial release