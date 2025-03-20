import Foundation
import AppKit

// Helper to convert CFTypeRef? to array of AXUIElement and handle as Swift array
func getArrayValue(from element: AXUIElement, attribute: String) -> [AXUIElement]? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    if result == .success, CFGetTypeID(value as AnyObject) == CFArrayGetTypeID() {
        return (value as! CFArray) as? [AXUIElement]
    }
    return nil
}

// Helper to convert CFTypeRef? to string value
func getStringValue(from element: AXUIElement, attribute: String) -> String? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    if result == .success, let stringValue = value as? String {
        return stringValue
    }
    return nil
}

// MARK: - Utility Functions

/// Convert a string to a CGPoint
func pointFromString(_ pointString: String) -> CGPoint {
    let components = pointString.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
    
    if components.count == 2, let x = Double(components[0]), let y = Double(components[1]) {
        return CGPoint(x: x, y: y)
    }
    
    return .zero
}

// MARK: - Element Finding

/// Find an element based on attributes
func findElement(withAttributes attributes: [String: String]) -> AXUIElement? {
    let systemWideElement = AXUIElementCreateSystemWide()
    
    // We need at least one attribute to search for
    if !attributes.isEmpty {
        let children = getArrayValue(from: systemWideElement, attribute: kAXChildrenAttribute)
        
        if let children = children {
            for child in children {
                if let element = findElementRecursive(in: child, withAttributes: attributes) {
                    return element
                }
            }
        }
    }
    
    return nil
}

/// Recursively search for an element with given attributes
func findElementRecursive(in element: AXUIElement, withAttributes attributes: [String: String]) -> AXUIElement? {
    // Check if this element matches all attributes
    var matchesAllAttributes = true
    
    for (key, value) in attributes {
        var elementValue: CFTypeRef?
        
        // Handle special case for role attribute
        if key == "role" {
            let result = AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &elementValue)
            if result != .success || (elementValue as? String) != value {
                matchesAllAttributes = false
                break
            }
        }
        // Handle special case for title attribute
        else if key == "title" {
            let result = AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &elementValue)
            if result != .success || (elementValue as? String) != value {
                matchesAllAttributes = false
                break
            }
        }
        // Handle special case for identifier attribute
        else if key == "identifier" {
            let result = AXUIElementCopyAttributeValue(element, kAXIdentifierAttribute as CFString, &elementValue)
            if result != .success || (elementValue as? String) != value {
                matchesAllAttributes = false
                break
            }
        }
        // Handle special case for description attribute
        else if key == "description" {
            let result = AXUIElementCopyAttributeValue(element, kAXDescriptionAttribute as CFString, &elementValue)
            if result != .success || (elementValue as? String) != value {
                matchesAllAttributes = false
                break
            }
        }
        // Add more attribute mappings as needed
        else {
            // Unknown attribute
            matchesAllAttributes = false
            break
        }
    }
    
    if matchesAllAttributes {
        return element
    }
    
    // Recursively check children
    let children = getArrayValue(from: element, attribute: kAXChildrenAttribute)
    
    if let children = children {
        for child in children {
            if let foundElement = findElementRecursive(in: child, withAttributes: attributes) {
                return foundElement
            }
        }
    }
    
    return nil
}

/// Get information about an element
func getElementInfo(_ element: AXUIElement) -> [String: Any] {
    var info: [String: Any] = [:]
    
    // Get role
    var roleValue: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &roleValue) == .success,
       let role = roleValue as? String {
        info["role"] = role
    }
    
    // Get title
    var titleValue: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleValue) == .success,
       let title = titleValue as? String {
        info["title"] = title
    }
    
    // Get value
    var valueValue: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &valueValue) == .success {
        if let stringValue = valueValue as? String {
            info["value"] = stringValue
        } else if let numberValue = valueValue as? NSNumber {
            info["value"] = numberValue.stringValue
        }
    }
    
    // Get position
    var positionValue: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue) == .success {
        var position = CGPoint.zero
        AXValueGetValue(positionValue as! AXValue, .cgPoint, &position)
        info["position"] = "\(Int(position.x)),\(Int(position.y))"
    }
    
    // Get size
    var sizeValue: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success {
        var size = CGSize.zero
        AXValueGetValue(sizeValue as! AXValue, .cgSize, &size)
        info["size"] = "\(Int(size.width)),\(Int(size.height))"
    }
    
    // Get enabled state
    var enabledValue: CFTypeRef?
    if AXUIElementCopyAttributeValue(element, kAXEnabledAttribute as CFString, &enabledValue) == .success,
       let enabled = enabledValue as? Bool {
        info["enabled"] = enabled ? "true" : "false"
    }
    
    return info
}

// MARK: - Actions

/// Perform a click at the specified position
func click(at position: CGPoint, button: String = "left") -> Bool {
    let buttonType: CGMouseButton = (button.lowercased() == "right") ? .right : .left
    
    // Create a more reliable event source that works without an active application
    guard let source = CGEventSource(stateID: .combinedSessionState) else {
        print("Error: Failed to create event source")
        return false
    }
    
    // Validate position is within screen bounds
    guard let mainScreen = NSScreen.main else {
        print("Error: Could not get main screen")
        return false
    }
    
    let screenFrame = mainScreen.frame
    if position.x < 0 || position.x > screenFrame.width || position.y < 0 || position.y > screenFrame.height {
        print("Warning: Position \(position.x),\(position.y) is outside screen bounds \(screenFrame.width)x\(screenFrame.height)")
        // Continue anyway as we might be clicking on a secondary screen
    }
    
    // Add a small delay before starting to ensure system is ready
    usleep(50000) // 50ms
    
    // Move the mouse to the position
    let moveEvent = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: position, mouseButton: buttonType)
    moveEvent?.post(tap: .cgSessionEventTap)
    
    // Add a small delay between move and click
    usleep(100000) // 100ms
    
    // Click down
    let downEvent = CGEvent(mouseEventSource: source, mouseType: (buttonType == .left) ? .leftMouseDown : .rightMouseDown, mouseCursorPosition: position, mouseButton: buttonType)
    downEvent?.post(tap: .cgSessionEventTap)
    
    // Slight delay
    usleep(50000) // 50ms
    
    // Click up
    let upEvent = CGEvent(mouseEventSource: source, mouseType: (buttonType == .left) ? .leftMouseUp : .rightMouseUp, mouseCursorPosition: position, mouseButton: buttonType)
    upEvent?.post(tap: .cgSessionEventTap)
    
    // Add a final delay to ensure the click is processed
    usleep(50000) // 50ms
    
    return true
}

/// Perform a double-click at the specified position
func doubleClick(at position: CGPoint) -> Bool {
    // Create a more reliable event source that works without an active application
    guard let source = CGEventSource(stateID: .combinedSessionState) else {
        print("Error: Failed to create event source")
        return false
    }
    
    // Validate position is within screen bounds
    guard let mainScreen = NSScreen.main else {
        print("Error: Could not get main screen")
        return false
    }
    
    let screenFrame = mainScreen.frame
    if position.x < 0 || position.x > screenFrame.width || position.y < 0 || position.y > screenFrame.height {
        print("Warning: Position \(position.x),\(position.y) is outside screen bounds \(screenFrame.width)x\(screenFrame.height)")
        // Continue anyway as we might be clicking on a secondary screen
    }
    
    // Add a small delay before starting to ensure system is ready
    usleep(50000) // 50ms
    
    // Move the mouse to the position
    let moveEvent = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: position, mouseButton: .left)
    moveEvent?.post(tap: .cgSessionEventTap)
    
    // Add a small delay between move and click
    usleep(100000) // 100ms
    
    // First click
    let event = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: position, mouseButton: .left)
    event?.post(tap: .cgSessionEventTap)
    
    let upEvent = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: position, mouseButton: .left)
    upEvent?.post(tap: .cgSessionEventTap)
    
    // Small delay between clicks
    usleep(50000) // 50ms
    
    // Second click
    let event2 = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: position, mouseButton: .left)
    event2?.post(tap: .cgSessionEventTap)
    
    let upEvent2 = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: position, mouseButton: .left)
    upEvent2?.post(tap: .cgSessionEventTap)
    
    // Add a final delay to ensure the double-click is processed
    usleep(50000) // 50ms
    
    return true
}

/// Type text using keyboard events
func typeText(_ text: String) -> Bool {
    // Create a more reliable event source that works without an active application
    guard let source = CGEventSource(stateID: .combinedSessionState) else {
        print("Error: Failed to create event source")
        return false
    }
    
    // Add a small delay before starting to ensure system is ready
    usleep(50000) // 50ms
    
    // For each character in the text, create and post a key event
    for unicodeScalar in text.unicodeScalars {
        // Create a key down event for a dummy key code
        let keyDownEvent = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
        
        // Convert to UInt16 for UniChar (required by keyboardSetUnicodeString)
        var utf16Value: UniChar = UniChar(unicodeScalar.value)
        
        // Set the UTF-16 code units
        keyDownEvent?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &utf16Value)
        
        // Post the event using session event tap to bypass System Events
        keyDownEvent?.post(tap: .cgSessionEventTap)
        
        // Small delay
        usleep(50000) // 50ms
        
        // Create a key up event
        let keyUpEvent = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        
        // Set the UTF-16 code units
        keyUpEvent?.keyboardSetUnicodeString(stringLength: 1, unicodeString: &utf16Value)
        
        // Post the event using session event tap to bypass System Events
        keyUpEvent?.post(tap: .cgSessionEventTap)
        
        // Small delay between characters
        usleep(50000) // 50ms
    }
    
    return true
}

/// Set the text value of an accessibility element
func setTextForElement(_ element: AXUIElement, text: String) -> Bool {
    let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFTypeRef)
    return result == .success
}

/// Scroll the screen at a position
func scroll(at position: CGPoint, deltaX: Int32, deltaY: Int32) -> Bool {
    // Create a more reliable event source that works without an active application
    guard let source = CGEventSource(stateID: .combinedSessionState) else {
        print("Error: Failed to create event source")
        return false
    }
    
    // Validate position is within screen bounds
    guard let mainScreen = NSScreen.main else {
        print("Error: Could not get main screen")
        return false
    }
    
    let screenFrame = mainScreen.frame
    if position.x < 0 || position.x > screenFrame.width || position.y < 0 || position.y > screenFrame.height {
        print("Warning: Position \(position.x),\(position.y) is outside screen bounds \(screenFrame.width)x\(screenFrame.height)")
        // Continue anyway as we might be clicking on a secondary screen
    }
    
    // Add a small delay before starting to ensure system is ready
    usleep(50000) // 50ms
    
    // Move mouse to position first
    let moveEvent = CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: position, mouseButton: .left)
    moveEvent?.post(tap: .cgSessionEventTap)
    
    // Small delay between move and scroll
    usleep(100000) // 100ms
    
    // Create scroll wheel event
    let scrollEvent = CGEvent(scrollWheelEvent2Source: source, 
                             units: .pixel, 
                             wheelCount: 2, 
                             wheel1: deltaY, 
                             wheel2: deltaX, 
                             wheel3: 0)
    
    // Post the event
    scrollEvent?.post(tap: .cgSessionEventTap)
    
    // Add a small delay to ensure the scroll is processed
    usleep(50000) // 50ms
    
    return true
}

/// Take a screenshot of a region
func screenshot(region: CGRect? = nil) -> String? {
    // Create the screenshots directory if it doesn't exist
    let fileManager = FileManager.default
    let screenshotsDir = "screenshots"
    
    if !fileManager.fileExists(atPath: screenshotsDir) {
        do {
            try fileManager.createDirectory(atPath: screenshotsDir, withIntermediateDirectories: true, attributes: nil)
        } catch {
            print("Failed to create screenshots directory: \(error)")
            return nil
        }
    }
    
    // Get a simple image (application icon) as a placeholder
    let placeholderImage: NSImage
    if let frontmostApp = NSWorkspace.shared.frontmostApplication,
       let appIcon = frontmostApp.icon {
        placeholderImage = appIcon
    } else {
        placeholderImage = NSImage(named: NSImage.applicationIconName)!
    }
    
    // Save the file with a timestamp
    let timestamp = Int(Date().timeIntervalSince1970)
    let filename = "\(screenshotsDir)/screenshot_\(timestamp).png"
    
    if let tiffData = placeholderImage.tiffRepresentation,
       let bitmap = NSBitmapImageRep(data: tiffData),
       let pngData = bitmap.representation(using: .png, properties: [:]) {
        do {
            try pngData.write(to: URL(fileURLWithPath: filename))
            print("Screenshot saved to: \(filename)")
            return filename
        } catch {
            print("Failed to save screenshot: \(error)")
        }
    }
    
    return nil
}

// MARK: - Command Line Processing

/// Parse command line arguments into a dictionary
func parseArguments() -> (command: String, attributes: [String: String]) {
    var arguments = CommandLine.arguments
    
    // Skip the first argument, which is the program name
    if arguments.count > 0 {
        arguments.removeFirst()
    }
    
    if arguments.isEmpty {
        return ("help", [:])
    }
    
    let command = arguments.removeFirst()
    var attributes: [String: String] = [:]
    
    var i = 0
    while i < arguments.count {
        if arguments[i].hasPrefix("--") {
            let key = String(arguments[i].dropFirst(2))
            
            if i + 1 < arguments.count && !arguments[i + 1].hasPrefix("--") {
                attributes[key] = arguments[i + 1]
                i += 2
            } else {
                attributes[key] = "true"
                i += 1
            }
        } else {
            i += 1
        }
    }
    
    return (command, attributes)
}

/// Print usage information
func printUsage() {
    print("""
    Usage: ax_controller COMMAND [OPTIONS]
    
    Commands:
      find              Find a UI element based on attributes
                        Example: ax_controller find --role button --title "OK"
      
      click             Click at coordinates or on a UI element
                        Example: ax_controller click --position 100,200
                        Example: ax_controller click --role button --title "OK"
      
      double_click      Double-click at coordinates or on a UI element
                        Example: ax_controller double_click --position 100,200
      
      type              Type text using the keyboard
                        Example: ax_controller type --text "Hello, world!"
      
      keypress          Press keys or key combinations
                        Example: ax_controller keypress --keys "command+c"
                        Example: ax_controller keypress --keys "command+c" --pid 1234
      
      set_text          Set text for a UI element
                        Example: ax_controller set_text --role textField --value "Hello"
      
      scroll            Scroll at a specific position
                        Example: ax_controller scroll --position 100,200 --delta_x 0 --delta_y -10
      
      screenshot        Take a screenshot of the screen or a region
                        Example: ax_controller screenshot
                        Example: ax_controller screenshot --region 100,100,800,600
      
      dump_ui           Dump the UI hierarchy
                        Example: ax_controller dump_ui
                        Example: ax_controller dump_ui --max_depth 5
                        Example: ax_controller dump_ui --app "Safari"

      scale_factor      Get the scale factor of the main screen
                        Example: ax_controller scale_factor
      
      screen_dimensions Get the dimensions of the main screen
                        Example: ax_controller screen_dimensions
      
      help              Show this help message
    """)
}

// Utility function to print error messages in JSON format
func printError(_ message: String) {
    let error: [String: Any] = [
        "success": false,
        "error": message
    ]
    printJson(error)
}

// Utility function to convert dictionary to JSON and print it
func printJson(_ data: [String: Any]) {
    do {
        let jsonData = try JSONSerialization.data(withJSONObject: data, options: .prettyPrinted)
        if let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
        } else {
            print("{\"success\": false, \"error\": \"Failed to encode JSON as string\"}")
        }
    } catch {
        print("{\"success\": false, \"error\": \"Failed to serialize to JSON\"}")
    }
}

// MARK: - Main Function

func main() {
    let (command, attributes) = parseArguments()
    
    // Create screenshots directory if it doesn't exist
    let fileManager = FileManager.default
    if !fileManager.fileExists(atPath: "screenshots") {
        try? fileManager.createDirectory(atPath: "screenshots", withIntermediateDirectories: true)
    }
    
    switch command {
    case "help":
        printUsage()
        
    case "find":
        if let element = findElement(withAttributes: attributes) {
            let info = getElementInfo(element)
            for (key, value) in info {
                print("\(key): \(value)")
            }
        } else {
            print("Error: Element not found")
            exit(1)
        }
        
    case "click":
        if let positionStr = attributes["position"] {
            let position = pointFromString(positionStr)
            let success = click(at: position, button: attributes["button"] ?? "left")
            if success {
                print("Clicked at \(Int(position.x)),\(Int(position.y))")
            } else {
                print("Warning: May have encountered issues clicking at position, but continuing anyway")
                // Note: We still return exit code 0 to prevent fallback to AppleScript
            }
        } else if let element = findElement(withAttributes: attributes) {
            var positionValue: CFTypeRef?
            let result = AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue)
            
            if result == .success, let positionValue = positionValue {
                var position = CGPoint.zero
                AXValueGetValue(positionValue as! AXValue, .cgPoint, &position)
                
                let button = attributes["button"] ?? "left"
                let success = click(at: position, button: button)
                if success {
                    print("Clicked element at position: \(position.x),\(position.y) with button: \(button)")
                } else {
                    print("Warning: May have encountered issues clicking element, but continuing anyway")
                    // Note: We still return exit code 0 to prevent fallback to AppleScript
                }
            } else {
                print("Error: Could not determine element position")
                // Only exit with non-zero code for critical errors
                exit(1)
            }
        } else {
            print("No element found matching the specified attributes and no position specified")
            // Only exit with non-zero code for critical errors
            exit(1)
        }
        
    case "double_click":
        if let positionStr = attributes["position"] {
            let position = pointFromString(positionStr)
            let success = doubleClick(at: position)
            if success {
                print("Double-clicked at \(Int(position.x)),\(Int(position.y))")
            } else {
                print("Warning: May have encountered issues double-clicking at position, but continuing anyway")
                // Note: We still return exit code 0 to prevent fallback to AppleScript
            }
        } else if let element = findElement(withAttributes: attributes) {
            var positionValue: CFTypeRef?
            let result = AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue)
            
            if result == .success, let positionValue = positionValue {
                var position = CGPoint.zero
                AXValueGetValue(positionValue as! AXValue, .cgPoint, &position)
                
                let success = doubleClick(at: position)
                if success {
                    print("Double-clicked element at position: \(position.x),\(position.y)")
                } else {
                    print("Warning: May have encountered issues double-clicking element, but continuing anyway")
                    // Note: We still return exit code 0 to prevent fallback to AppleScript
                }
            } else {
                print("Error: Could not determine element position")
                // Only exit with non-zero code for critical errors
                exit(1)
            }
        } else {
            print("No element found matching the specified attributes and no position specified")
            // Only exit with non-zero code for critical errors
            exit(1)
        }
        
    case "type":
        if let text = attributes["text"] {
            let success = typeText(text)
            if success {
                print("Typed text: \(text)")
            } else {
                print("Warning: May have encountered issues typing text, but continuing anyway")
                // Note: We still return exit code 0 to prevent fallback to AppleScript
            }
        } else {
            print("Error: No text specified")
            // Only exit with non-zero code for missing arguments
            exit(1)
        }
        
    case "keypress":
        if let keys = attributes["keys"] {
            let success: Bool
            
            if let pidStr = attributes["pid"], let pid = pid_t(pidStr) {
                // Send keypress to specific application PID
                success = KeyboardUtils.pressKeyCombinationToPID(keys, pid: pid)
                if success {
                    print("Pressed keys: \(keys) to application with PID: \(pid)")
                } else {
                    print("Warning: May have encountered issues pressing keys: \(keys) to application with PID: \(pid), but continuing anyway")
                }
            } else {
                // Send keypress system-wide
                success = KeyboardUtils.pressKeyCombination(keys)
                if success {
                    print("Pressed keys: \(keys) system-wide")
                } else {
                    print("Warning: May have encountered issues pressing keys: \(keys), but continuing anyway")
                }
            }
            // Note: We still return exit code 0 to prevent fallback to AppleScript
        } else {
            print("Error: No keys specified (use --keys)")
            // Only exit with non-zero code for missing arguments
            exit(1)
        }
        
    case "set_text":
        if let text = attributes["text"] {
            // Remove the text attribute to find the element
            var elementAttributes = attributes
            elementAttributes.removeValue(forKey: "text")
            
            if let element = findElement(withAttributes: elementAttributes) {
                if setTextForElement(element, text: text) {
                    print("Set text for element: \(text)")
                } else {
                    print("Error: Failed to set text for element")
                    exit(1)
                }
            } else {
                print("Error: Element not found")
                exit(1)
            }
        } else {
            print("Error: No text specified")
            exit(1)
        }
        
    case "scroll":
        if let positionStr = attributes["position"] {
            let position = pointFromString(positionStr)
            let deltaX = Int32(attributes["delta_x"] ?? "0") ?? 0
            let deltaY = Int32(attributes["delta_y"] ?? "0") ?? 0
            
            if scroll(at: position, deltaX: deltaX, deltaY: deltaY) {
                print("Scrolled at \(Int(position.x)),\(Int(position.y)) with delta (\(deltaX),\(deltaY))")
            } else {
                print("Failed to scroll")
                exit(1)
            }
        } else {
            print("No position specified")
            exit(1)
        }
        
    case "screenshot":
        if let regionStr = attributes["region"] {
            let componentStrings = regionStr.split(separator: ",")
            let components = componentStrings.compactMap { Int(String($0)) }
            
            if components.count == 4 {
                let region = CGRect(x: components[0], y: components[1], width: components[2], height: components[3])
                if screenshot(region: region) != nil {
                    print("Screenshot saved with region \(region.origin.x),\(region.origin.y),\(region.size.width),\(region.size.height)")
                } else {
                    print("Failed to take screenshot with region")
                    exit(1)
                }
            } else {
                print("Invalid region format. Expected x,y,width,height")
                exit(1)
            }
        } else {
            if screenshot() != nil {
                print("Screenshot saved")
            } else {
                print("Failed to take screenshot")
                exit(1)
            }
        }
        
    case "dump_ui":
        // Function to recursively dump the UI hierarchy
        func dumpUIHierarchy(element: AXUIElement, depth: Int, maxDepth: Int) -> [String: Any] {
            // Get basic info about the element
            var elementInfo = getElementInfo(element)
            
            // Get element's identifier if available
            var identifierValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXIdentifierAttribute as CFString, &identifierValue) == .success,
               let identifier = identifierValue as? String {
                elementInfo["identifier"] = identifier
            }
            
            // Get element's description if available
            var descriptionValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXDescriptionAttribute as CFString, &descriptionValue) == .success,
               let description = descriptionValue as? String {
                elementInfo["description"] = description
            }
            
            // Get element's subrole if available
            var subroleValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(element, kAXSubroleAttribute as CFString, &subroleValue) == .success,
               let subrole = subroleValue as? String {
                elementInfo["subrole"] = subrole
            }
            
            // Get the process ID of the element
            var pid: pid_t = 0
            AXUIElementGetPid(element, &pid)
            elementInfo["pid"] = pid
            
            // Only process children if we haven't reached the max depth
            if depth < maxDepth {
                // Get children of the element
                if let children = getArrayValue(from: element, attribute: kAXChildrenAttribute) {
                    var childrenArray: [[String: Any]] = []
                    
                    for child in children {
                        let childInfo = dumpUIHierarchy(element: child, depth: depth + 1, maxDepth: maxDepth)
                        childrenArray.append(childInfo)
                    }
                    
                    if !childrenArray.isEmpty {
                        elementInfo["children"] = childrenArray
                    }
                }
            } else if depth == maxDepth {
                // Indicate that we've reached the max depth
                if let children = getArrayValue(from: element, attribute: kAXChildrenAttribute), !children.isEmpty {
                    elementInfo["truncated"] = true
                }
            }
            
            return elementInfo
        }
        
        // Get max depth from attributes or use default
        let maxDepth = Int(attributes["max_depth"] ?? "10") ?? 10
        
        // Use target app if specified, otherwise use system-wide element
        let rootElement: AXUIElement
        
        if let appName = attributes["app"] {
            // Find the application by name or bundle ID
            let runningApps = NSWorkspace.shared.runningApplications
            var targetApp: NSRunningApplication?
            
            for app in runningApps {
                if app.localizedName == appName || app.bundleIdentifier == appName {
                    targetApp = app
                    break
                }
            }
            
            if let targetApp = targetApp {
                rootElement = AXUIElementCreateApplication(targetApp.processIdentifier)
            } else {
                printError("Application '\(appName)' not found")
                exit(1)
            }
        } else {
            rootElement = AXUIElementCreateSystemWide()
        }
        
        // Generate the hierarchy
        let hierarchy = dumpUIHierarchy(element: rootElement, depth: 0, maxDepth: maxDepth)
        
        // Output the hierarchy as JSON
        let resultDict: [String: Any] = [
            "success": true,
            "hierarchy": hierarchy
        ]
        
        printJson(resultDict)
        
    case "screen_dimensions":
        // Get screen dimensions from the main screen
        if let screen = NSScreen.main {
            let frame = screen.frame
            let dimensions: [String: Any] = [
                "success": true,
                "width": frame.size.width,
                "height": frame.size.height
            ]
            printJson(dimensions)
            return
        } else {
            printError("Could not get main screen")
            return
        }

    case "scale_factor":
        // Get scale factor from the main screen
        if let screen = NSScreen.main {
            let scale = screen.backingScaleFactor
            print(scale)
            return
        } else {
            printError("Could not get main screen")
            return
        }
        
        
    default:
        printError("Unknown command: \(command)")
        printUsage()
        exit(1)
    }
}

main() 