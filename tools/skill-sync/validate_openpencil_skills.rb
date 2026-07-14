#!/usr/bin/env ruby
# frozen_string_literal: true

require "yaml"
require "pathname"

workspace = Pathname.new(__dir__).join("../..").expand_path
skills_root = workspace.join("skills")
errors = []
warnings = []

skill_dirs = skills_root.children.select { |path| path.directory? && path.basename.to_s.start_with?("openpencil-") }.sort

if skill_dirs.empty?
  abort "FAIL: no canonical OpenPencil skill packages found under #{skills_root}"
end

def parse_frontmatter(path)
  contents = path.read
  parts = contents.split(/^---\s*$\n/)
  raise "missing YAML frontmatter" if parts.length < 3

  [YAML.safe_load(parts[1]), contents]
end

def markdown_links(contents)
  contents.scan(/\[[^\]]+\]\(([^)]+)\)/).flatten
end

skill_dirs.each do |skill_dir|
  name = skill_dir.basename.to_s
  skill_file = skill_dir.join("SKILL.md")
  agent_file = skill_dir.join("agents/openai.yaml")

  unless skill_file.file?
    errors << "#{name}: missing SKILL.md"
    next
  end

  begin
    metadata, skill_contents = parse_frontmatter(skill_file)
    errors << "#{name}: frontmatter name is #{metadata["name"].inspect}" unless metadata["name"] == name
    description = metadata["description"].to_s.strip
    errors << "#{name}: description is empty" if description.empty?
    warnings << "#{name}: description does not explain when to use the skill" unless description.match?(/\bUse when\b/i)

    markdown_links(skill_contents).each do |target|
      next if target.match?(%r{\A(?:https?://|#)})

      resolved = skill_dir.join(target.split("#", 2).first).cleanpath
      errors << "#{name}: broken SKILL.md link #{target}" unless resolved.exist?
    end
  rescue Psych::SyntaxError => e
    errors << "#{name}: invalid SKILL.md YAML: #{e.message.lines.first.strip}"
  rescue StandardError => e
    errors << "#{name}: #{e.message}"
  end

  unless agent_file.file?
    errors << "#{name}: missing agents/openai.yaml"
    next
  end

  begin
    agent = YAML.safe_load(agent_file.read)
    interface = agent.fetch("interface")
    %w[display_name short_description default_prompt].each do |key|
      errors << "#{name}: agents/openai.yaml missing interface.#{key}" if interface[key].to_s.strip.empty?
    end
    warnings << "#{name}: default prompt does not invoke $#{name}" unless interface["default_prompt"].to_s.include?("$#{name}")
  rescue Psych::SyntaxError => e
    errors << "#{name}: invalid agents/openai.yaml: #{e.message.lines.first.strip}"
  rescue StandardError => e
    errors << "#{name}: agents/openai.yaml #{e.message}"
  end

  skill_dir.glob("**/*.md").each do |markdown|
    markdown_links(markdown.read).each do |target|
      next if target.match?(%r{\A(?:https?://|#)})

      resolved = markdown.dirname.join(target.split("#", 2).first).cleanpath
      errors << "#{name}: broken link #{target} in #{markdown.relative_path_from(skill_dir)}" unless resolved.exist?
    end
  end
end

knowledge = skills_root.join("openpencil-knowledge-canvas")
if knowledge.directory?
  combined = knowledge.glob("**/*").select(&:file?).map(&:read).join("\n")
  required_phrases = [
    "Document block",
    "Collection",
    "Canvas object",
    "Graph object",
    "Design artifact",
    "Live App Block",
    "one shared runtime",
    "Illustrative preview",
    "production source",
    "query_workspace_items",
    "Export the primary composition",
  ]
  required_phrases.each do |phrase|
    errors << "openpencil-knowledge-canvas: missing required contract phrase #{phrase.inspect}" unless combined.include?(phrase)
  end

  obsolete_commands = %w[mutate_workspace_objects query_workspace_objects search_workspace]
  obsolete_commands.each do |command|
    errors << "openpencil-knowledge-canvas: obsolete semantic command #{command}" if combined.include?(command)
  end
else
  errors << "missing openpencil-knowledge-canvas package"
end

warnings.each { |warning| warn "WARN: #{warning}" }

if errors.any?
  errors.each { |error| warn "FAIL: #{error}" }
  exit 1
end

puts "PASS: validated #{skill_dirs.length} canonical OpenPencil skill package(s)"
