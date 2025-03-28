import jsonld from 'https://cdn.jsdelivr.net/npm/jsonld@8.3.3/+esm';

// DOM elements
const jsonldInput = document.getElementById('jsonld-input');
const visualizeBtn = document.getElementById('visualize-btn');
const exampleBtn = document.getElementById('example-btn');
const clearBtn = document.getElementById('clear-btn');
const recenterBtn = document.getElementById('recenter-btn');
const expandLevelBtn = document.getElementById('expand-level-btn');
const collapseLevelBtn = document.getElementById('collapse-level-btn');
const messageBox = document.getElementById('message-box');
const graphContainer = document.getElementById('graph-container');

// Network and data objects
let network = null;
let nodesDataset = new vis.DataSet();
let edgesDataset = new vis.DataSet();
let jsonldData = null;
let expandedNodes = new Set();
let expandedMapping = {};

// Network layout options
const options = {
    layout: {
        hierarchical: {
            enabled: true,
            direction: 'LR',
            sortMethod: 'directed',
            nodeSpacing: 180,
            levelSeparation: 250
        }
    },
    physics: {
        enabled: false
    },
    interaction: {
        dragNodes: true,
        dragView: true,
        zoomView: true,
        hover: true
    },
    nodes: {
        shape: 'box',
        margin: 10,
        font: {
            size: 14,
            multi: false
        },
        borderWidth: 1,
        shadow: true,
        widthConstraint: {
            maximum: 200
        },
        heightConstraint: {
            minimum: 30
        }
    },
    edges: {
        arrows: {
            to: {enabled: true, scaleFactor: 1}
        },
        color: {
            color: '#2c3e50',
            highlight: '#34495e'
        },
        smooth: {
            type: 'cubicBezier',
            forceDirection: 'horizontal'
        },
        font: {
            align: 'middle',
            size: 12
        }
    }
};


function initApp() {
    initNetwork();

    recenterBtn.addEventListener('click', recenterGraph);
    visualizeBtn.addEventListener('click', handleVisualize);
    exampleBtn.addEventListener('click', loadExample);
    clearBtn.addEventListener('click', clearAll);
    expandLevelBtn.addEventListener('click', expandLevel);
    collapseLevelBtn.addEventListener('click', collapseLevel);
}


// Parse and visualize JSON-LD
async function handleVisualize() {
    try {
        const input = jsonldInput.value.trim();
        if (!input) {
            showMessage('Please enter a JSON-LD document', true);
            return;
        }
        jsonldData = JSON.parse(input);
        nodesDataset.clear();
        edgesDataset.clear();
        expandedNodes.clear();
        expandedMapping = {};
        await processJsonLd(jsonldData);
        recenterBtn.click();
        showMessage('JSON-LD document visualized successfully');
    } catch (error) {
        console.error('Error processing JSON-LD:', error);
        showMessage(`Error: ${error.message}`, true);
    }
}


// To prevent long node labels
function truncateText(text, maxLength = 80) {
    if (typeof text !== 'string') return String(text);
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
}


// Process a single JSON-LD node
async function processNode(node, parentId, nodeId) {
    if (typeof node === 'string' && node.startsWith('@')) return;
    if (typeof node === 'object' && node !== null) {
        let nodeLabel = '';
        let url = null;
        if (node['@id']) {
            nodeLabel = node['@id'];
            url = node['@id'];
        } else if (node['@value']) {
            nodeLabel = String(node['@value']);
        } else {
            nodeLabel = "Blank Node";
        }
        if (node['@type']) {
            const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
            nodeLabel += "\nType: " + types.map(t => shortenUri(t)).join(', ');
        }

        // Truncate long labels
        nodeLabel = truncateText(nodeLabel, 80);

        const hasNestedNodes = Object.keys(node).some(k =>
            !['@id', '@type', '@value', '@language'].includes(k)
        );
        nodesDataset.add({
            id: nodeId,
            label: nodeLabel,
            url: url,
            expandable: hasNestedNodes,
            color: !node['@id'] ? '#f39c12' : '#3498db',
            borderWidth: hasNestedNodes ? 2 : 1,
            shapeProperties: {borderDashes: hasNestedNodes ? [5, 5] : false},
            raw: node
        });
        if (parentId) {
            edgesDataset.add({from: parentId, to: nodeId});
        }
    }
}


// Animate layout changes by enabling physics temporarily
function animateLayout() {
    network.setOptions({physics: {enabled: true}});
    network.once("stabilized", () => {
        network.setOptions({physics: {enabled: false}});
    });
}


// Recenter the graph
function recenterGraph() {
    if (network) {
        network.fit();
    }
}


// Expand a node to show its children
async function expandNode(node) {
    const nodeId = node.id;
    expandedNodes.add(nodeId);
    nodesDataset.update({
        id: nodeId,
        borderWidth: 2,
        shapeProperties: {borderDashes: [5, 5]}
    });
    expandedMapping[nodeId] = [];
    if (node.isPredicate) {
        const values = Array.isArray(node.raw) ? node.raw : [node.raw];
        for (let i = 0; i < values.length; i++) {
            const valId = `${nodeId}_val_${i}`;
            const val = values[i];
            if (typeof val === 'object' && val !== null) {
                await processNode(val, nodeId, valId);
            } else {
                const isUrl = typeof val === 'string' && (val.startsWith('http://') || val.startsWith('https://'));

                // Truncate long values
                const displayVal = truncateText(String(val), 80);

                nodesDataset.add({
                    id: valId,
                    label: displayVal,
                    url: isUrl ? val : null,
                    color: isUrl ? '#2ecc71' : '#3498db'
                });
                edgesDataset.add({from: nodeId, to: valId});
            }
            expandedMapping[nodeId].push(valId);
        }
    } else {
        const rawNode = node.raw;
        for (const key in rawNode) {
            if (['@id', '@type', '@value', '@language'].includes(key)) continue;
            const predId = `${nodeId}_pred_${key}`;
            const predLabel = shortenUri(key);
            const objects = rawNode[key];
            const predicateExpandable = Array.isArray(objects) && objects.length > 0;
            nodesDataset.add({
                id: predId,
                label: predLabel,
                color: '#9b59b6',
                font: {color: 'white'},
                raw: objects,
                isPredicate: true,
                expandable: predicateExpandable,
                borderWidth: predicateExpandable ? 2 : 1,
                shapeProperties: {borderDashes: predicateExpandable ? [5, 5] : false}
            });
            edgesDataset.add({from: nodeId, to: predId});
            expandedMapping[nodeId].push(predId);
        }
    }
    animateLayout();
}


// Collapse a node by recursively removing its children
function collapseNode(nodeId) {
    if (expandedMapping[nodeId]) {
        expandedMapping[nodeId].forEach(childId => {
            if (expandedNodes.has(childId)) {
                collapseNode(childId);
            }
            nodesDataset.remove({id: childId});
            edgesDataset.forEach(edge => {
                if (edge.from === nodeId && edge.to === childId) {
                    edgesDataset.remove(edge.id);
                }
            });
        });
        delete expandedMapping[nodeId];
    }
    expandedNodes.delete(nodeId);
    nodesDataset.update({
        id: nodeId,
        borderWidth: 2,
        shapeProperties: {borderDashes: [5, 5]}
    });
    animateLayout();
}


// Process JSON-LD and create the graph
async function processJsonLd(data) {
    const expanded = await jsonld.expand(data);
    if (Array.isArray(expanded)) {
        for (let i = 0; i < expanded.length; i++) {
            await processNode(expanded[i], null, `root_${i}`);
            const rootNode = nodesDataset.get(`root_${i}`);
            if (rootNode && rootNode.expandable) {
                expandNode(rootNode);
            }
        }
    } else {
        await processNode(expanded, null, 'root');
        const rootNode = nodesDataset.get('root');
        if (rootNode && rootNode.expandable) {
            expandNode(rootNode);
        }
    }
    animateLayout();
}


// Shorten URI for display
function shortenUri(uri) {
    if (typeof uri !== 'string') return String(uri);
    if (!uri.startsWith('http://') && !uri.startsWith('https://')) return uri;
    const parts = uri.split(/[/#]/);
    return parts[parts.length - 1] || uri;
}


// Initialize the network
function initNetwork() {
    const data = {
        nodes: nodesDataset,
        edges: edgesDataset
    };
    network = new vis.Network(graphContainer, data, options);

    graphContainer.style.cursor = 'grab';
    network.on('click', function (params) {
        if (params.nodes.length > 0) {
            const nodeId = params.nodes[0];
            const node = nodesDataset.get(nodeId);

            if (node.expandable) {
                if (expandedNodes.has(nodeId)) {
                    collapseNode(nodeId);
                } else {
                    expandNode(node);
                }
            }
        }
    });

    network.on('hoverNode', function (params) {
        const node = nodesDataset.get(params.node);
        if (node && node.expandable) {
            graphContainer.style.cursor = 'pointer';
        }
    });

    network.on('blurNode', function (params) {
        graphContainer.style.cursor = 'grab';
    });

    network.on('dragStart', function () {
        graphContainer.style.cursor = 'grabbing';
    });

    network.on('dragEnd', function () {
        graphContainer.style.cursor = 'grab';
    });
}


// Display success/error message
function showMessage(message, isError = false) {
    messageBox.textContent = message;
    messageBox.style.display = 'block';
    if (isError) {
        messageBox.classList.add('error');
    } else {
        messageBox.classList.remove('error');
    }
    setTimeout(() => {
        messageBox.style.display = 'none';
    }, 5000);
}


// Expand one level of expandable nodes
function expandLevel() {
    // Visible nodes that are expandable but not yet expanded
    const nodes = nodesDataset.get({
        filter: function (node) {
            return node.expandable && !expandedNodes.has(node.id);
        }
    });

    for (const node of nodes) {
        expandNode(node);
    }
}


// Collapse one level of expanded nodes
function collapseLevel() {
    const expandedNodeIds = Array.from(expandedNodes);

    // Find leaf nodes (nodes that are expanded but don't have expanded children)
    const leafNodes = [];
    for (const nodeId of expandedNodeIds) {
        // Check if this node has any expanded children
        const hasExpandedChildren = expandedMapping[nodeId] &&
            expandedMapping[nodeId].some(childId => expandedNodes.has(childId));

        if (!hasExpandedChildren) {
            leafNodes.push(nodeId);
        }
    }

    // Collapse only the leaf nodes
    for (const nodeId of leafNodes) {
        collapseNode(nodeId);
    }
}


// Load example JSON-LD document
function loadExample() {
    const example = {
        "@context": {
            "snomed": "http://snomed.info/id/",
            "custom": "https://example.org/generations-study/custom-ontology#",
            "side": {
                "@id": "snomed:384727002",
                "@type": "@vocab",
                "@context": {
                    "L": "snomed:7771000",
                    "R": "snomed:24028007"
                }
            },
            "screenDetected": {
                "@id": "snomed:171176006",
                "@type": "@vocab",
                "@context": {
                    "Y": "snomed:373066001",
                    "N": "snomed:373067005"
                }
            },
            "specimenType": {
                "@id": "snomed:122548005",
                "@type": "@vocab",
                "@context": {
                    "WBB": "snomed:44578009",
                    "WLE": "snomed:237371007",
                    "M": "snomed:1231734007",
                    "NBO": "snomed:21911005",
                    "OB": "snomed:736615002",
                    "Re-ex": "snomed:395165008",
                    "SE": "snomed:237370008",
                    "TMP": "snomed:33496007",
                    "FNA": "snomed:387736007",
                    "LB": "custom:specimenType-LB"
                }
            },
            "specimenWeight": "snomed:371506001",
            "postNeoadjuvantChemo": {
                "@id": "snomed:400001000004103",
                "@type": "@vocab",
                "@context": {
                    "C": "snomed:1259200004",
                    "E": "snomed:169413002"
                }
            },
            "closestRelevantMargin": "snomed:371489008",
            "excisionMargin": {
                "@id": "snomed:395536008",
                "@type": "@vocab",
                "@context": {
                    "RRM": "snomed:370109009",
                    "NRM": "snomed:310342002"
                }
            },
            "nfo": "http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#",
            "fileName": "nfo:fileName",
            "dct": "http://purl.org/dc/terms/",
            "conformsTo": {
                "@id": "dct:conformsTo",
                "@type": "@id"
            },
            "prov": "http://www.w3.org/ns/prov#",
            "xsd": "http://www.w3.org/2001/XMLSchema#",
            "schema": "https://schema.org/"
        },
        "@graph": [
            {
                "fileName": "01.txt",
                "side": "L",
                "screenDetected": "Y",
                "specimenType": "M",
                "specimenWeight": 1320,
                "postNeoadjuvantChemo": null,
                "closestRelevantMargin": 5,
                "excisionMargin": "NRM"
            },
            {
                "fileName": "02.txt",
                "side": "L",
                "screenDetected": null,
                "specimenType": "WLE",
                "specimenWeight": 35,
                "postNeoadjuvantChemo": null,
                "closestRelevantMargin": 1,
                "excisionMargin": "NRM"
            },
            {
                "fileName": "03.txt",
                "side": "R",
                "screenDetected": "Y",
                "specimenType": "WLE",
                "specimenWeight": 40,
                "postNeoadjuvantChemo": null,
                "closestRelevantMargin": 2,
                "excisionMargin": "NRM"
            },
            {
                "fileName": "04.txt",
                "side": "L",
                "screenDetected": "N",
                "specimenType": "WLE",
                "specimenWeight": null,
                "postNeoadjuvantChemo": null,
                "closestRelevantMargin": 3,
                "excisionMargin": "NRM"
            },
            {
                "fileName": "05.txt",
                "side": "L",
                "screenDetected": null,
                "specimenType": "M",
                "specimenWeight": 800,
                "postNeoadjuvantChemo": null,
                "closestRelevantMargin": null,
                "excisionMargin": null
            }
        ],
        "conformsTo": [
            "https://raw.githubusercontent.com/jeyabbalas/medical-report-information-extractor/refs/heads/main/examples/bcn_generations_pathology_data/config/schemas/specimen.json",
            "https://raw.githubusercontent.com/jeyabbalas/medical-report-information-extractor/refs/heads/main/examples/bcn_generations_pathology_data/config/schemas/excision.json"
        ],
        "@type": "prov:Entity",
        "prov:wasGeneratedBy": {
            "@type": "prov:Activity",
            "prov:startedAtTime": {
                "@type": "xsd:dateTime",
                "@value": "2025-03-28T15:38:44.307Z"
            },
            "prov:endedAtTime": {
                "@type": "xsd:dateTime",
                "@value": "2025-03-28T15:38:44.338Z"
            },
            "prov:wasAssociatedWith": {
                "@id": "https://jeyabbalas.github.io/medical-report-information-extractor/?configUrl=https%3A%2F%2Fraw.githubusercontent.com%2Fjeyabbalas%2Fmedical-report-information-extractor%2Frefs%2Fheads%2Fmain%2Fexamples%2Fbcn_generations_pathology_data%2FminConfig.json",
                "@type": "prov:SoftwareAgent",
                "prov:label": "Medical Report Information Extractor",
                "schema:description": "A Web application that leverages large language models to extract structured information from from free-text reports."
            },
            "prov:used": [
                {
                    "@id": "https://api.openai.com/v1/chat/completions",
                    "@type": "prov:Entity",
                    "schema:softwareVersion": "gpt-4o-mini",
                    "schema:description": "A large language model."
                }
            ]
        }
    };

    jsonldInput.value = JSON.stringify(example, null, 2);
}


function clearAll() {
    jsonldInput.value = '';
    nodesDataset.clear();
    edgesDataset.clear();
    expandedNodes.clear();
    expandedMapping = {};
    jsonldData = null;
}


document.addEventListener('DOMContentLoaded', initApp);