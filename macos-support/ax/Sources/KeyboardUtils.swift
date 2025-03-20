import Foundation
import Cocoa

/// Key code mapping for common special keys
struct KeyCode {
    static let returnKey: CGKeyCode = 0x24
    static let tab: CGKeyCode = 0x30
    static let space: CGKeyCode = 0x31
    static let delete: CGKeyCode = 0x33
    static let escape: CGKeyCode = 0x35
    static let command: CGKeyCode = 0x37
    static let shift: CGKeyCode = 0x38
    static let capsLock: CGKeyCode = 0x39
    static let option: CGKeyCode = 0x3A
    static let control: CGKeyCode = 0x3B
    static let rightShift: CGKeyCode = 0x3C
    static let rightOption: CGKeyCode = 0x3D
    static let rightControl: CGKeyCode = 0x3E
    static let function: CGKeyCode = 0x3F
    static let f1: CGKeyCode = 0x7A
    static let f2: CGKeyCode = 0x78
    static let f3: CGKeyCode = 0x63
    static let f4: CGKeyCode = 0x76
    static let f5: CGKeyCode = 0x60
    static let f6: CGKeyCode = 0x61
    static let f7: CGKeyCode = 0x62
    static let f8: CGKeyCode = 0x64
    static let f9: CGKeyCode = 0x65
    static let f10: CGKeyCode = 0x6D
    static let f11: CGKeyCode = 0x67
    static let f12: CGKeyCode = 0x6F
    static let arrowLeft: CGKeyCode = 0x7B
    static let arrowRight: CGKeyCode = 0x7C
    static let arrowDown: CGKeyCode = 0x7D
    static let arrowUp: CGKeyCode = 0x7E
    static let pageUp: CGKeyCode = 0x74
    static let pageDown: CGKeyCode = 0x79
    static let home: CGKeyCode = 0x73
    static let end: CGKeyCode = 0x77
}

/// Flags for modifier keys
struct ModifierFlag {
    static let capsLock: CGEventFlags = .maskAlphaShift
    static let shift: CGEventFlags = .maskShift
    static let control: CGEventFlags = .maskControl
    static let option: CGEventFlags = .maskAlternate
    static let command: CGEventFlags = .maskCommand
    static let function: CGEventFlags = .maskSecondaryFn
}

/// Utility for keyboard operations
class KeyboardUtils {
    
    /// Maps a key name to its CGKeyCode
    static func keyCodeFor(key: String) -> CGKeyCode? {
        switch key.lowercased() {
        case "return", "enter": return KeyCode.returnKey
        case "tab": return KeyCode.tab
        case "space": return KeyCode.space
        case "delete", "backspace": return KeyCode.delete
        case "escape", "esc": return KeyCode.escape
        case "command", "cmd": return KeyCode.command
        case "shift": return KeyCode.shift
        case "option", "alt", "opt": return KeyCode.option
        case "control", "ctrl": return KeyCode.control
        case "capslock": return KeyCode.capsLock
        case "f1": return KeyCode.f1
        case "f2": return KeyCode.f2
        case "f3": return KeyCode.f3
        case "f4": return KeyCode.f4
        case "f5": return KeyCode.f5
        case "f6": return KeyCode.f6
        case "f7": return KeyCode.f7
        case "f8": return KeyCode.f8
        case "f9": return KeyCode.f9
        case "f10": return KeyCode.f10
        case "f11": return KeyCode.f11
        case "f12": return KeyCode.f12
        case "left", "arrowleft": return KeyCode.arrowLeft
        case "right", "arrowright": return KeyCode.arrowRight
        case "up", "arrowup": return KeyCode.arrowUp
        case "down", "arrowdown": return KeyCode.arrowDown
        case "home": return KeyCode.home
        case "end": return KeyCode.end
        case "pageup": return KeyCode.pageUp
        case "pagedown": return KeyCode.pageDown
        default: return nil
        }
    }
    
    /// Maps a modifier name to its CGEventFlags
    static func modifierFlagFor(key: String) -> CGEventFlags? {
        switch key.lowercased() {
        case "command", "cmd": return ModifierFlag.command
        case "shift": return ModifierFlag.shift
        case "option", "alt", "opt": return ModifierFlag.option
        case "control", "ctrl": return ModifierFlag.control
        case "capslock": return ModifierFlag.capsLock
        case "function", "fn": return ModifierFlag.function
        default: return nil
        }
    }
    
    /// Parses a key combination string (e.g., "command+c") and returns key codes and flags
    static func parseKeyCombination(_ combination: String) -> (keys: [CGKeyCode], flags: CGEventFlags) {
        let components = combination.split(separator: "+").map { String($0.trimmingCharacters(in: .whitespaces)) }
        
        var keys: [CGKeyCode] = []
        var flags: CGEventFlags = []
        
        for component in components {
            if let flag = modifierFlagFor(key: component) {
                flags.insert(flag)
            } else if let keyCode = keyCodeFor(key: component) {
                keys.append(keyCode)
            } else if component.count == 1, let scalar = component.unicodeScalars.first {
                // For single character keys
                keys.append(CGKeyCode(scalar.value))
            }
        }
        
        return (keys, flags)
    }
    
    /// Presses a key combination
    static func pressKeyCombination(_ combination: String) -> Bool {
        let (keys, flags) = parseKeyCombination(combination)
        guard !keys.isEmpty else { return false }
        
        // Create a more robust event source with combined hidSystem and privateSystem state
        guard let source = CGEventSource(stateID: .combinedSessionState) else {
            // Fall back to just HID system state if combined fails
            guard let hidSource = CGEventSource(stateID: .hidSystemState) else {
                return false
            }
            
            // Use the fallback source
            return performKeyEvents(keys: keys, flags: flags, source: hidSource)
        }
        
        return performKeyEvents(keys: keys, flags: flags, source: source)
    }
    
    /// Helper to actually perform the key events with a given source
    private static func performKeyEvents(keys: [CGKeyCode], flags: CGEventFlags, source: CGEventSource) -> Bool {
        // Add a small delay before starting to ensure system is ready
        usleep(50000) // 50ms
        
        for keyCode in keys {
            let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true)
            let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
            
            keyDown?.flags = flags
            keyUp?.flags = flags
            
            // Try to ensure event goes to the right place
            keyDown?.post(tap: .cgSessionEventTap)
            usleep(50000) // Small delay between key down and up (50ms)
            keyUp?.post(tap: .cgSessionEventTap)
            
            // Add a delay between keys if there are multiple
            if keys.count > 1 {
                usleep(100000) // 100ms between keys
            }
        }
        
        return true
    }
    
    /// Presses a key combination and targets a specific application PID
    static func pressKeyCombinationToPID(_ combination: String, pid: pid_t) -> Bool {
        let (keys, flags) = parseKeyCombination(combination)
        guard !keys.isEmpty else { return false }
        
        // Create a more robust event source with combined hidSystem and privateSystem state
        guard let source = CGEventSource(stateID: .combinedSessionState) else {
            // Fall back to just HID system state if combined fails
            guard let hidSource = CGEventSource(stateID: .hidSystemState) else {
                return false
            }
            
            // Use the fallback source
            return performKeyEventsToPID(keys: keys, flags: flags, source: hidSource, pid: pid)
        }
        
        return performKeyEventsToPID(keys: keys, flags: flags, source: source, pid: pid)
    }
    
    /// Helper to actually perform the key events with a given source and target a specific PID
    private static func performKeyEventsToPID(keys: [CGKeyCode], flags: CGEventFlags, source: CGEventSource, pid: pid_t) -> Bool {
        // Add a small delay before starting to ensure system is ready
        usleep(50000) // 50ms
        
        for keyCode in keys {
            let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true)
            let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
            
            keyDown?.flags = flags
            keyUp?.flags = flags
            
            // Post events to the specific application
            keyDown?.postToPid(pid)
            usleep(50000) // Small delay between key down and up (50ms)
            keyUp?.postToPid(pid)
            
            // Add a delay between keys if there are multiple
            if keys.count > 1 {
                usleep(100000) // 100ms between keys
            }
        }
        
        return true
    }
} 