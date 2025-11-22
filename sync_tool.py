#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Chat Topic Synchronization Tool
Synchronizes chat topics between Frontend A and Frontend B
"""

import json
import os
import re
import shutil
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime

# ========== CONFIGURATION ==========
FRONTEND_A_PATH = r"你的VCPChat路径\VCPChat"
FRONTEND_B_PATH = r"你的Obsidian仓库路径\这是你仓库的名字"
AGENT_MAPPING_FILE = r"你的agent_mapping.json路径\agent_mapping.json" # OChat的Agent的ID对VChat的Agent的ID的映射

# Topic naming pattern: topic_{timestamp}
TOPIC_PATTERN = re.compile(r'^topic_(\d+)$')

# ========== UTILITY FUNCTIONS ==========

def load_agent_mapping(filepath: str) -> Dict[str, Dict[str, str]]:
    """Load agent mapping from JSON file.
    
    Returns:
        Dict with B agent IDs as keys, containing 'a_id' and 'name'
    """
    with open(filepath, 'r', encoding='utf-8') as f:
        return json.load(f)


def is_valid_topic_id(topic_id: str, data: Optional[Dict] = None) -> bool:
    """Check if topic ID matches the pattern topic_{timestamp}.
    
    Args:
        topic_id: The topic ID to check
        data: Optional topic data to check for createdAt field
    
    Returns:
        True if valid topic
    """
    if TOPIC_PATTERN.match(topic_id):
        return True
    
    # Also check if the data contains createdAt timestamp
    if data and isinstance(data, dict) and 'createdAt' in data:
        return True
    
    return False


def generate_message_id(timestamp: int, role: str) -> str:
    """Generate a unique message ID."""
    import random
    import string
    random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=7))
    return f"msg_{timestamp}_{role}_{random_suffix}"


# ========== SCANNER FUNCTIONS ==========

def scan_frontend_a(base_path: str, agent_mapping: Dict) -> Dict[str, Dict]:
    """Scan Frontend A for all agents and topics.
    
    Returns:
        Dict[agent_id, {'config_path': str, 'topics': Dict[topic_id, topic_data]}]
    """
    result = {}
    agents_dir = Path(base_path) / "APPData" / "Agents"
    
    if not agents_dir.exists():
        print(f"Warning: Agents directory not found: {agents_dir}")
        return result
    
    # Get all agent IDs that are in the mapping (as values)
    valid_a_ids = {mapping['a_id'] for mapping in agent_mapping.values()}
    
    for agent_dir in agents_dir.iterdir():
        if not agent_dir.is_dir():
            continue
        
        agent_id = agent_dir.name
        
        # Only process agents that are in the mapping
        if agent_id not in valid_a_ids:
            continue
        
        config_path = agent_dir / "config.json"
        if not config_path.exists():
            print(f"Warning: config.json not found for agent {agent_id}")
            continue
        
        # Load topics from UserData
        user_topics_dir = Path(base_path) / "APPData" / "UserData" / agent_id / "topics"
        topics = {}
        
        if user_topics_dir.exists():
            for topic_dir in user_topics_dir.iterdir():
                if not topic_dir.is_dir():
                    continue
                
                topic_id = topic_dir.name
                history_file = topic_dir / "history.json"
                
                if not history_file.exists():
                    continue
                
                # Load history data
                try:
                    with open(history_file, 'r', encoding='utf-8') as f:
                        topic_data = json.load(f)
                    
                    # Validate topic
                    if is_valid_topic_id(topic_id, {'createdAt': True}):  # A's topics are in messages
                        topics[topic_id] = {
                            'data': topic_data,
                            'path': history_file
                        }
                except Exception as e:
                    print(f"Error loading topic {topic_id}: {e}")
        
        result[agent_id] = {
            'config_path': str(config_path),
            'topics': topics
        }
    
    return result


def scan_frontend_b(base_path: str, agent_mapping: Dict) -> Dict[str, Dict]:
    """Scan Frontend B for all agents and topics (including hidden directories).
    
    Returns:
        Dict[agent_id, {'topics': Dict[topic_id, topic_data]}]
    """
    result = {}
    chats_dir = Path(base_path) / ".OChat-chats"
    
    if not chats_dir.exists():
        print(f"Warning: .OChat-chats directory not found: {chats_dir}")
        return result
    
    # Only process agents that are in the mapping
    valid_b_ids = list(agent_mapping.keys())
    
    for agent_dir in chats_dir.iterdir():
        if not agent_dir.is_dir():
            continue
        
        # Extract agent ID from directory name (format: _Agent_{id}_{id})
        dir_name = agent_dir.name
        if not dir_name.startswith("_Agent_"):
            continue
        
        # Extract the first ID
        parts = dir_name.split('_')
        if len(parts) >= 3:
            agent_id = parts[2]
        else:
            continue
        
        # Only process agents in mapping
        if agent_id not in valid_b_ids:
            continue
        
        topics = {}
        
        # Scan both 'topics' and '.saved_chats' directories
        for subdir_name in ['topics', '.saved_chats']:
            topics_dir = agent_dir / subdir_name
            
            if not topics_dir.exists():
                continue
            
            for topic_dir in topics_dir.iterdir():
                if not topic_dir.is_dir():
                    continue
                
                topic_id = topic_dir.name
                history_file = topic_dir / "history.json"
                
                if not history_file.exists():
                    continue
                
                # Load history data
                try:
                    with open(history_file, 'r', encoding='utf-8') as f:
                        topic_data = json.load(f)
                    
                    # Validate topic
                    if is_valid_topic_id(topic_id, topic_data):
                        # Extract just the ID from topic_1234567890 format
                        id_match = TOPIC_PATTERN.match(topic_id)
                        if id_match:
                            timestamp_id = id_match.group(1)
                        else:
                            timestamp_id = topic_data.get('id', topic_id)
                        
                        topics[topic_id] = {
                            'data': topic_data,
                            'path': history_file,
                            'source_dir': subdir_name
                        }
                except Exception as e:
                    print(f"Error loading topic {topic_id}: {e}")
        
        result[agent_id] = {
            'topics': topics
        }
    
    return result


# ========== CONVERSION FUNCTIONS ==========

def convert_a_to_b(topic_data: List[Dict], topic_id: str, agent_b_id: str, title: Optional[str] = None) -> Dict:
    """Convert Frontend A format to Frontend B format.
    
    Args:
        topic_data: Array of messages from Frontend A
        topic_id: The topic ID (should be topic_{timestamp})
        agent_b_id: Agent ID for Frontend B
        title: Optional title, will be generated if not provided
    
    Returns:
        Dict in Frontend B format
    """
    # Extract timestamp from topic_id
    match = TOPIC_PATTERN.match(topic_id)
    if match:
        timestamp = int(match.group(1))
    else:
        timestamp = int(datetime.now().timestamp() * 1000)
    
    # Generate title if not provided
    if not title:
        # Try to get from first user message
        for msg in topic_data:
            if msg.get('role') == 'user':
                content = msg.get('content', '')
                title = content[:20] if content else f"新话题 {timestamp}"
                break
        if not title:
            title = f"新话题 {timestamp}"
    
    # Convert messages: strip Frontend A specific fields
    converted_messages = []
    for msg in topic_data:
        converted_msg = {
            'role': msg.get('role'),
            'content': msg.get('content', '')
        }
        converted_messages.append(converted_msg)
    
    # Get latest timestamp for updatedAt
    updated_at = timestamp
    for msg in topic_data:
        msg_ts = msg.get('timestamp', 0)
        if msg_ts > updated_at:
            updated_at = msg_ts
    
    return {
        'id': str(timestamp),
        'agentId': agent_b_id,
        'title': title,
        'updatedAt': updated_at,
        'messages': converted_messages,
        'manualTitle': True  # Critical: set to true when syncing A -> B
    }


def convert_b_to_a(topic_data: Dict, topic_id: str, agent_a_id: str) -> List[Dict]:
    """Convert Frontend B format to Frontend A format.
    
    Args:
        topic_data: Frontend B topic data object
        topic_id: The topic ID
        agent_a_id: Agent ID for Frontend A
    
    Returns:
        List of messages in Frontend A format
    """
    messages = topic_data.get('messages', [])
    
    # Generate base timestamp from topic creation
    match = TOPIC_PATTERN.match(topic_id)
    if match:
        base_timestamp = int(match.group(1))
    else:
        base_timestamp = topic_data.get('updatedAt', int(datetime.now().timestamp() * 1000))
    
    converted_messages = []
    
    # Generate timestamps incrementally
    current_timestamp = base_timestamp
    time_increment = 1000  # 1 second between messages
    
    for msg in messages:
        role = msg.get('role')
        
        converted_msg = {
            'role': role,
            'name': 'Zeta' if role == 'user' else topic_data.get('title', 'Agent'),
            'content': msg.get('content', ''),
            'timestamp': current_timestamp,
            'id': generate_message_id(current_timestamp, role),
            'attachments': []
        }
        
        # Add assistant-specific fields
        if role == 'assistant':
            converted_msg.update({
                'isThinking': False,
                'avatarUrl': f'file://D:\\\\路径\\\\VCPChat\\\\AppData\\\\Agents\\\\{agent_a_id}\\\\avatar.png',
                'avatarColor': 'rgb(207, 191, 177)',
                'isGroupMessage': False,
                'agentId': agent_a_id,
                'finishReason': 'completed'
            })
        
        converted_messages.append(converted_msg)
        current_timestamp += time_increment
    
    return converted_messages


# ========== SYNC FUNCTIONS ==========

def update_frontend_a_config(config_path: str, topic_id: str, topic_title: str, created_at: int):
    """Update Frontend A's config.json to include a new topic.
    
    Args:
        config_path: Path to config.json
        topic_id: ID of the new topic
        topic_title: Title of the topic
        created_at: Creation timestamp
    """
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        # Check if topic already exists
        existing_topics = config.get('topics', [])
        for topic in existing_topics:
            if topic.get('id') == topic_id:
                print(f"  Topic {topic_id} already in config.json")
                return
        
        # Add new topic
        new_topic_entry = {
            'id': topic_id,
            'name': topic_title,
            'createdAt': created_at,
            'locked': True,
            'unread': False,
            'creatorSource': 'sync'
        }
        
        # Insert at the correct position based on createdAt timestamp
        # Topics should be sorted by createdAt in descending order (newest first)
        insert_position = len(existing_topics)  # Default: append to end
        
        for i, topic in enumerate(existing_topics):
            topic_created_at = topic.get('createdAt', 0)
            if created_at > topic_created_at:
                insert_position = i
                break
        
        existing_topics.insert(insert_position, new_topic_entry)
        config['topics'] = existing_topics
        
        # Log the insertion position for debugging
        if insert_position == 0:
            print(f"  → Inserted at top (newest topic)")
        elif insert_position == len(existing_topics) - 1:
            print(f"  → Inserted at bottom (oldest topic)")
        else:
            print(f"  → Inserted at position {insert_position}")
        
        # Write back
        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        
        print(f"  ✓ Updated config.json with topic {topic_id}")
    
    except Exception as e:
        print(f"  ✗ Error updating config.json: {e}")


def sync_agents(agent_a_id: str, agent_b_id: str, data_a: Dict, data_b: Dict):
    """Synchronize topics between two agents.
    
    Args:
        agent_a_id: Agent ID in Frontend A
        agent_b_id: Agent ID in Frontend B
        data_a: Scanned data from Frontend A
        data_b: Scanned data from Frontend B
    """
    topics_a = data_a.get('topics', {})
    topics_b = data_b.get('topics', {})
    
    print(f"\n{'='*60}")
    print(f"Syncing: {agent_a_id} (A) <-> {agent_b_id} (B)")
    print(f"  Topics in A: {len(topics_a)}")
    print(f"  Topics in B: {len(topics_b)}")
    
    # Get topic IDs
    ids_a = set(topics_a.keys())
    ids_b = set(topics_b.keys())
    
    # A has, B doesn't -> sync A to B
    only_in_a = ids_a - ids_b
    # B has, A doesn't -> sync B to A
    only_in_b = ids_b - ids_a
    
    print(f"  Only in A: {len(only_in_a)}")
    print(f"  Only in B: {len(only_in_b)}")
    
    # Sync A -> B
    if only_in_a:
        print(f"\n  Syncing A -> B ({len(only_in_a)} topics):")
        
        synced_count = 0
        skipped_count = 0
        
        for topic_id in only_in_a:
            # Skip topics that don't match topic_{timestamp} pattern
            if not TOPIC_PATTERN.match(topic_id):
                print(f"    ⊘ {topic_id} (skipped - invalid format)")
                skipped_count += 1
                continue
            
            topic_info = topics_a[topic_id]
            topic_data = topic_info['data']
            
            # Get title from config
            config_path = data_a['config_path']
            try:
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                title = None
                for t in config.get('topics', []):
                    if t.get('id') == topic_id:
                        title = t.get('name', '新话题')
                        break
            except:
                title = None
            
            # Convert
            converted = convert_a_to_b(topic_data, topic_id, agent_b_id, title)
            
            # Write to B
            b_agent_dir = Path(FRONTEND_B_PATH) / ".OChat-chats" / f"_Agent_{agent_b_id}_{agent_b_id}"
            b_topics_dir = b_agent_dir / "topics"
            b_topics_dir.mkdir(parents=True, exist_ok=True)
            
            topic_dir = b_topics_dir / topic_id
            topic_dir.mkdir(exist_ok=True)
            
            history_file = topic_dir / "history.json"
            
            with open(history_file, 'w', encoding='utf-8') as f:
                json.dump(converted, f, ensure_ascii=False, indent=2)
            
            print(f"    ✓ {topic_id} -> B")
            synced_count += 1
        
        if skipped_count > 0:
            print(f"    (Skipped {skipped_count} topics with invalid format)")
    
    # Sync B -> A
    if only_in_b:
        print(f"\n  Syncing B -> A ({len(only_in_b)} topics):")
        
        for topic_id in only_in_b:
            topic_info = topics_b[topic_id]
            topic_data = topic_info['data']
            
            # Convert
            converted = convert_b_to_a(topic_data, topic_id, agent_a_id)
            
            # Write to A
            a_user_dir = Path(FRONTEND_A_PATH) / "APPData" / "UserData" / agent_a_id / "topics"
            a_user_dir.mkdir(parents=True, exist_ok=True)
            
            topic_dir = a_user_dir / topic_id
            topic_dir.mkdir(exist_ok=True)
            
            history_file = topic_dir / "history.json"
            
            with open(history_file, 'w', encoding='utf-8') as f:
                json.dump(converted, f, ensure_ascii=False, indent=2)
            
            print(f"    ✓ {topic_id} -> A")
            
            # Update config.json
            match = TOPIC_PATTERN.match(topic_id)
            created_at = int(match.group(1)) if match else topic_data.get('updatedAt', 0)
            title = topic_data.get('title', '新话题')
            
            update_frontend_a_config(data_a['config_path'], topic_id, title, created_at)


# ========== MAIN ==========

def main():
    """Main synchronization logic."""
    print("Chat Topic Synchronization Tool")
    print("="*60)
    
    # Load agent mapping
    print(f"\nLoading agent mapping from: {AGENT_MAPPING_FILE}")
    agent_mapping = load_agent_mapping(AGENT_MAPPING_FILE)
    print(f"Found {len(agent_mapping)} agent mappings")
    
    # Scan both frontends
    print(f"\nScanning Frontend A: {FRONTEND_A_PATH}")
    data_a_all = scan_frontend_a(FRONTEND_A_PATH, agent_mapping)
    print(f"Found {len(data_a_all)} agents in A")
    
    print(f"\nScanning Frontend B: {FRONTEND_B_PATH}")
    data_b_all = scan_frontend_b(FRONTEND_B_PATH, agent_mapping)
    print(f"Found {len(data_b_all)} agents in B")
    
    # Perform synchronization for each mapped agent pair
    for agent_b_id, mapping in agent_mapping.items():
        agent_a_id = mapping['a_id']
        agent_name = mapping.get('name', 'Unknown')
        
        if agent_a_id not in data_a_all:
            print(f"\nWarning: Agent {agent_name} ({agent_a_id}) not found in Frontend A")
            continue
        
        if agent_b_id not in data_b_all:
            print(f"\nWarning: Agent {agent_name} ({agent_b_id}) not found in Frontend B")
            continue
        
        sync_agents(agent_a_id, agent_b_id, data_a_all[agent_a_id], data_b_all[agent_b_id])
    
    print(f"\n{'='*60}")
    print("Synchronization complete!")


if __name__ == "__main__":
    main()
